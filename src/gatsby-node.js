import { pipe } from "lodash/fp"
import chalk from "chalk"
import { forEach, forEachSeries } from "p-iteration"
import { printGraphQLError, queryAll, queryOnce } from "./lib"
import { createClient } from "./create-client"

import {
  ArticleNode,
  BlogNode,
  CollectionNode,
  CommentNode,
  ProductNode,
  ProductOptionNode,
  ProductVariantNode,
  ShopPolicyNode,
  ShopDetailsNode,
  PageNode,
} from "./nodes"
import {
  SHOP,
  CONTENT,
  NODE_TO_ENDPOINT_MAPPING,
  ARTICLE,
  BLOG,
  COLLECTION,
  PRODUCT,
  SHOP_POLICY,
  SHOP_DETAILS,
  PAGE,
} from "./constants"
import {
  ARTICLES_QUERY,
  BLOGS_QUERY,
  COLLECTIONS_QUERY,
  PRODUCTS_QUERY,
  SHOP_POLICIES_QUERY,
  SHOP_DETAILS_QUERY,
  PAGES_QUERY,
} from "./queries"

export const sourceNodes = async (
  {
    actions: { createNode, touchNode },
    createNodeId,
    store,
    cache,
    getCache,
    reporter,
  },
  {
    shopName,
    accessToken,
    apiVersion = `2023-01`,
    verbose = true,
    paginationSize = 250,
    paginationDelay = 500,
    languages = ["en"],
    includeCollections = [SHOP, CONTENT],
    shopifyQueries = {},
  }
) => {
  const createTranslatedClient = locale =>
    createClient(shopName, accessToken, apiVersion, locale)

  const defaultQueries = {
    articles: ARTICLES_QUERY,
    blogs: BLOGS_QUERY,
    collections: COLLECTIONS_QUERY,
    products: PRODUCTS_QUERY,
    shopPolicies: SHOP_POLICIES_QUERY,
    shopDetails: SHOP_DETAILS_QUERY,
    pages: PAGES_QUERY,
  }

  const queries = { ...defaultQueries, ...shopifyQueries }

  // Convenience function to namespace console messages.
  const formatMsg = msg =>
    chalk`\n{blue gatsby-source-shopify/${shopName}} ${msg}`

  try {
    console.log(formatMsg(`starting to fetch data from Shopify`))

    // Arguments used for file node creation.
    const imageArgs = {
      createNode,
      createNodeId,
      touchNode,
      store,
      cache,
      getCache,
      reporter,
    }

    // Arguments used for node creation.
    const args = {
      createTranslatedClient,
      createNode,
      createNodeId,
      formatMsg,
      verbose,
      imageArgs,
      paginationSize,
      paginationDelay,
      queries,
      languages,
    }

    // Message printed when fetching is complete.
    const msg = formatMsg(`finished fetching data from Shopify`)

    if (includeCollections.includes(SHOP)) {
      await createNodes(COLLECTION, queries.collections, CollectionNode, args)
      await createNodes(
        PRODUCT,
        queries.products,
        ProductNode,
        args,
        async (product, productNode) => {
          if (product.variants)
            await forEach(product.variants.edges, async edge => {
              return createNode(
                await ProductVariantNode(imageArgs, productNode)(edge.node)
              )
            })

          if (product.options)
            await forEach(product.options, async option =>
              createNode(await ProductOptionNode(imageArgs)(option))
            )
        }
      )
      await createShopPolicies(args)
      await createShopDetails(args)
    }
    if (includeCollections.includes(CONTENT)) {
      await createNodes(BLOG, queries.blogs, BlogNode, args)
      await createNodes(
        ARTICLE,
        queries.articles,
        ArticleNode,
        args,
        async x => {
          if (x.comments)
            await forEach(x.comments.edges, async edge =>
              createNode(await CommentNode(imageArgs)(edge.node))
            )
        }
      )
      await createPageNodes(PAGE, queries.pages, PageNode, args)
    }
  } catch (e) {
    console.error(chalk`\n{red error} an error occurred while sourcing data`)

    // If not a GraphQL request error, let Gatsby print the error.
    if (!e.hasOwnProperty(`request`)) throw e

    printGraphQLError(e)
  }
}

/**
 * Fetch and create nodes for the provided endpoint, query, and node factory.
 */
const createNodes = async (
  endpoint,
  query,
  nodeFactory,
  {
    createTranslatedClient,
    createNode,
    formatMsg,
    verbose,
    imageArgs,
    paginationSize,
    paginationDelay,
    languages,
  },
  f = async () => {}
) => {
  // Message printed when fetching is complete.
  const msg = formatMsg(`fetched and processed ${endpoint} nodes`)

  if (verbose) console.time(msg)

  await forEachSeries(languages, async locale =>
    forEachSeries(
      await queryAll(
        createTranslatedClient(locale),
        [NODE_TO_ENDPOINT_MAPPING[endpoint]],
        query,
        paginationDelay,
        paginationSize
      ),
      async entity => {
        const node = await nodeFactory(imageArgs)(mapEntityIds(entity, locale))
        await createNode(node)
        await f(entity, node)
      }
    )
  )
  if (verbose) console.timeEnd(msg)
}

/**
 * Fetch and create nodes for shop policies.
 */
const createShopDetails = async ({
  createTranslatedClient,
  createNode,
  formatMsg,
  verbose,
  queries,
  languages,
}) => {
  // // Message printed when fetching is complete.
  const msg = formatMsg(`fetched and processed ${SHOP_DETAILS} nodes`)

  if (verbose) console.time(msg)
  await forEach(languages, async locale => {
    const { shop } = await queryOnce(
      createTranslatedClient(locale),
      queries.shopDetails
    )
    createNode(ShopDetailsNode(nodeWithLocale(shop, locale)))
  })
  if (verbose) console.timeEnd(msg)
}

/**
 * Fetch and create nodes for shop policies.
 */
const createShopPolicies = async ({
  createTranslatedClient,
  createNode,
  formatMsg,
  verbose,
  queries,
  languages,
}) => {
  // Message printed when fetching is complete.
  const msg = formatMsg(`fetched and processed ${SHOP_POLICY} nodes`)

  if (verbose) console.time(msg)
  await forEach(languages, async locale => {
    const { shop: policies } = await queryOnce(
      createTranslatedClient(locale),
      queries.shopPolicies
    )

    Object.entries(policies)
      .filter(([_, policy]) => Boolean(policy))
      .forEach(
        pipe(
          ([type, policy]) =>
            ShopPolicyNode(nodeWithLocale(policy, locale), { type }),
          createNode
        )
      )
  })
  if (verbose) console.timeEnd(msg)
}

const createPageNodes = async (
  endpoint,
  query,
  nodeFactory,
  {
    createTranslatedClient,
    createNode,
    formatMsg,
    verbose,
    paginationSize,
    paginationDelay,
    languages,
  },
  f = async () => {}
) => {
  // Message printed when fetching is complete.
  const msg = formatMsg(`fetched and processed ${endpoint} nodes`)

  if (verbose) console.time(msg)
  await forEach(languages, async locale => {
    await forEach(
      await queryAll(
        createTranslatedClient(locale),
        [NODE_TO_ENDPOINT_MAPPING[endpoint]],
        query,
        paginationDelay,
        paginationSize
      ),
      async entity => {
        const node = await nodeFactory(entity)
        createNode(nodeWithLocale(node, locale))
        await f(entity)
      }
    )
  })
  if (verbose) console.timeEnd(msg)
}

const nodeWithLocale = (node, locale) => ({
  ...node,
  id: `${locale}__${node.id}`,
  locale,
})

const mapEntityIds = (node, locale) => {
  if (node.products) {
    node.products.edges.forEach(edge => {
      edge.node = nodeWithLocale(edge.node, locale)
    })
  }
  if (node.variants) {
    node.variants.edges.forEach(edge => {
      edge.node = nodeWithLocale(edge.node, locale)
    })
  }

  if (node.options) {
    node.options = node.options.map(option => nodeWithLocale(option, locale))
  }
  if (node.comments) {
    node.comments.forEach(edge => {
      edge.node = nodeWithLocale(edge.node, locale)
    })
  }
  if (node.image) {
    node.image = nodeWithLocale(node.image, locale)
  }
  if (node.images && node.images.edges) {
    node.images.edges.forEach(edge => {
      edge.node = nodeWithLocale(edge.node, locale)
    })
  }
  return nodeWithLocale(node, locale)
}
