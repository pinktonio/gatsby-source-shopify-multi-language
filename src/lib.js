import prettyjson from "prettyjson"
import chalk from "chalk"
import { get, getOr, last } from "lodash/fp"

/**
 * Print an error from a GraphQL client
 */
export const printGraphQLError = e => {
  const prettyjsonOptions = { keysColor: `red`, dashColor: `red` }

  if (e.response && e.response.errors) {
    if (e.message.startsWith(`access denied`)) {
      console.error(chalk`\n{yellow Check your token has this read authorization,
      or omit fetching this object using the "includeCollections" options in gatsby-source-shopify plugin options}`)
    }
    console.error(prettyjson.render(e.response.errors, prettyjsonOptions))
  }

  if (e.request) console.error(prettyjson.render(e.request, prettyjsonOptions))
}

const timeout = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Request a query from a client.
 */
export const queryOnce = async (client, query, first = 250, after) =>
  await client.request(query, { first, after })

/**
 * Get all paginated data from a query. Will execute multiple requests as
 * needed.
 */

const DEFAULT_DELAY = 500
const DEFAULT_FIRST_OBJECTS = 250

export const queryAll = async (
  client,
  path,
  query,
  delay = DEFAULT_DELAY,
  first = DEFAULT_FIRST_OBJECTS,
  after = null,
  aggregatedResponse = null
) => {
  const t1 = new Date()
  const data = await queryOnce(client, query, first, after)
  const t2 = new Date()
  const requestTime = t1.getTime() - t2.getTime()
  console.log(path)
  console.log(`Requested ${requestTime / 1000}`)
  const edges = getOr([], [...path, `edges`], data)
  const nodes = edges.map(edge => edge.node)

  aggregatedResponse = aggregatedResponse
    ? aggregatedResponse.concat(nodes)
    : nodes

  if (get([...path, `pageInfo`, `hasNextPage`], data)) {
    const tt1 = new Date()
    await timeout(delay)
    const tt2 = new Date()
    const awaitTime = tt1.getTime() - tt2.getTime()
    console.log(`awaited ${awaitTime / 1000}`)
    const returnData = await queryAll(
      client,
      path,
      query,
      delay,
      first,
      last(edges).cursor,
      aggregatedResponse
    )
    return returnData
  }

  return aggregatedResponse
}
