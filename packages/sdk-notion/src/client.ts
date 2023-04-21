import { Client } from '@notionhq/client'
import { NotionToMarkdown } from 'notion-to-md'
import asyncPool from 'tiny-async-pool'
import { props } from './utils'
import { NotionConfig, NotionDoc, NotionSort, NotionSortPreset } from './types'
import { out } from '@elog/shared'
import { DocDetail, NotionCatalog } from '@elog/types'

/**
 * Notion SDK
 */
class NotionClient {
  config: NotionConfig
  notion: Client
  n2m: NotionToMarkdown
  catalog: NotionCatalog[] = []
  constructor(config: NotionConfig) {
    this.config = config
    this.config.token = config.token || process.env.NOTION_TOKEN!
    if (!this.config.token) {
      out.err('缺少参数', '缺少Notion Token')
      process.exit(-1)
    }
    this.notion = new Client({ auth: this.config.token })
    this.n2m = new NotionToMarkdown({ notionClient: this.notion })
    // debug(`create client: databaseId: ${config.databaseId}`)
  }

  /**
   * 获取指定文章列表
   */
  async getPageList() {
    let sorts: any
    if (typeof this.config.sorts === 'boolean') {
      if (!this.config.sorts) {
        // 不排序
        sorts = undefined
      } else {
        // 默认排序
        sorts = [{ timestamp: 'created_time', direction: 'descending' }]
      }
      sorts = [{ timestamp: 'created_time', direction: 'descending' }]
    } else if (typeof this.config.sorts === 'string') {
      // 预设值
      const sortPreset = this.config.sorts as NotionSortPreset
      switch (sortPreset) {
        case NotionSortPreset.dateDesc:
          sorts = [{ property: 'date', direction: 'descending' }]
          break
        case NotionSortPreset.dateAsc:
          sorts = [{ property: 'date', direction: 'ascending' }]
          break
        case NotionSortPreset.sortDesc:
          sorts = [{ property: 'sort', direction: 'descending' }]
          break
        case NotionSortPreset.sortAsc:
          sorts = [{ property: 'sort', direction: 'ascending' }]
          break
        case NotionSortPreset.createTimeDesc:
          sorts = [{ timestamp: 'created_time', direction: 'descending' }]
          break
        case NotionSortPreset.createTimeAsc:
          sorts = [{ timestamp: 'created_time', direction: 'ascending' }]
          break
        case NotionSortPreset.updateTimeDesc:
          sorts = [{ timestamp: 'last_edited_time', direction: 'descending' }]
          break
        case NotionSortPreset.updateTimeAsc:
          sorts = [{ timestamp: 'last_edited_time', direction: 'ascending' }]
          break
        default:
          sorts = [{ timestamp: 'created_time', direction: 'descending' }]
      }
    } else {
      // 自定义排序
      sorts = this.config.sorts as NotionSort[]
    }

    let filter: any
    if (typeof this.config.filter === 'boolean') {
      if (!this.config.filter) {
        filter = undefined
      } else {
        filter = {
          property: 'status',
          select: {
            equals: '已发布',
          },
        }
      }
    } else if (!this.config.filter) {
      filter = {
        property: 'status',
        select: {
          equals: '已发布',
        },
      }
    } else {
      filter = this.config.filter
    }

    let resp = await this.notion.databases.query({
      database_id: this.config.databaseId,
      filter,
      sorts,
    })
    let docs = resp.results as NotionDoc[]
    docs = docs.map((doc) => {
      // 转换props
      doc.properties = props(doc)
      return doc
    })
    this.catalog = docs as unknown as NotionCatalog[]
    return docs
  }

  /**
   * 下载一篇文章
   * @param {*} page
   */
  async download(page: NotionDoc): Promise<DocDetail> {
    const blocks = await this.n2m.pageToMarkdown(page.id)
    let body = this.n2m.toMarkdownString(blocks)
    const timestamp = new Date(page.last_edited_time).getTime()
    return {
      id: page.id,
      doc_id: page.id,
      properties: page.properties,
      body,
      body_original: body,
      updated: timestamp,
    }
  }

  /**
   * 获取文章列表
   * @param cachedPages 已经下载过的pages
   * @param ids 需要下载的doc_id列表
   */
  async getPageDetailList(cachedPages: NotionDoc[], ids: string[]) {
    // 获取待发布的文章
    let articleList: DocDetail[] = []
    let pages: NotionDoc[] = cachedPages
    if (ids?.length) {
      // 取交集，过滤不需要下载的page
      pages = pages.filter((page) => {
        const exist = ids.indexOf(page.id) > -1
        if (!exist) {
          // @ts-ignore
          const title = page.properties.title
          out.access('跳过下载', title)
        }
        return exist
      })
    }
    if (!pages?.length) {
      out.access('跳过', '没有需要下载的文章')
      return articleList
    }
    const promise = async (page: NotionDoc) => {
      let article = await this.download(page)
      out.info('下载文档', article.properties.title)
      articleList.push(article)
    }
    await asyncPool(5, pages, promise)
    out.access('已下载数', String(articleList.length))
    return articleList
  }
}

export default NotionClient
