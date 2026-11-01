import { createHash } from 'node:crypto'
import type { BrowserContext, Locator, Page } from 'playwright'
import type { LinkedInCapture } from './linkedin-saved-api'

export const SAVED_URL = 'https://www.linkedin.com/my-items/saved-posts/'

const CARD_SEL = [
  'main div[data-chameleon-result-urn]',
  '.scaffold-finite-scroll__content div[data-chameleon-result-urn]',
].join(', ')
const SUMMARY_SEL = '[class*="entity-result__content-summary"]'
const SEE_MORE_SEL = "button.reusable-search-show-more-link, button:has-text('see more'), a:has-text('see more')"

export type AuthSignals = {
  url: string
  title: string
  loggedOut: boolean
  checkpoint: boolean
  restricted: boolean
}

export type CardFields = {
  urn: string
  view: string
  kind: string
  summary_text: string
  has_see_more: boolean
  update_url: string | null
  author_name: string | null
  author_url: string | null
  author_headline: string | null
  actor_text: string
  embedded_title: string
  saved_link_label: boolean
  has_image: boolean
}

export function normalizeContent(text: string | null | undefined) {
  if (!text) return ''
  const cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/(?:…|\.\.\.)?\s*see more\s*$/i, '')
  const lines = cleaned.split('\n').map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
  return lines.join('\n').trim().replace(/\n{3,}/g, '\n\n')
}

export function contentHash(text: string | null | undefined) {
  const body = normalizeContent(text)
  if (!body) return null
  return createHash('sha256').update(body).digest('hex')
}

export function linkedinUrlForUrn(urn: string) {
  return `https://www.linkedin.com/feed/update/${urn}/`
}

export function kindFromUrn(urn: string) {
  if (urn.includes(':article:')) return 'article'
  if (urn.includes(':activity:')) return 'activity'
  return 'unknown'
}

export function hardStopReason(signals: AuthSignals) {
  if (signals.loggedOut) return 'logged_out'
  if (signals.checkpoint) return 'checkpoint'
  if (signals.restricted) return 'restricted'
  return null
}

export async function authSignals(page: Page): Promise<AuthSignals> {
  return page.evaluate(() => {
    const text = (document.body?.innerText || '').slice(0, 4000)
    const href = location.href.toLowerCase()
    const head = text.slice(0, 800).toLowerCase()
    return {
      url: location.href,
      title: document.title,
      loggedOut: href.includes('/login') || href.includes('/uas/login')
        || head.includes('sign in to linkedin') || head.includes('join linkedin'),
      checkpoint: /checkpoint|security verification|verify your identity|unusual activity|captcha|challenge/i.test(text)
        || href.includes('checkpoint'),
      restricted: /account temporarily restricted|we've restricted|action blocked/i.test(text),
    }
  })
}

export async function scrollCollectUrns(page: Page, maxRounds = 40) {
  const seen: string[] = []
  const seenSet = new Set<string>()
  let stagnant = 0
  for (let round = 0; round < maxRounds; round += 1) {
    const urns = await page.evaluate((sel) => {
      return [...document.querySelectorAll(sel)]
        .map((element) => element.getAttribute('data-chameleon-result-urn'))
        .filter((urn): urn is string => Boolean(urn))
    }, CARD_SEL)
    let added = 0
    for (const urn of urns) {
      if (seenSet.has(urn)) continue
      seenSet.add(urn)
      seen.push(urn)
      added += 1
    }
    if (added === 0) stagnant += 1
    else stagnant = 0
    if (stagnant >= 3) break
    await page.evaluate(() => window.scrollTo(0, document.body?.scrollHeight ?? 0))
    await page.waitForTimeout(1400)
    await page.evaluate(() => {
      const scrollers = [...document.querySelectorAll('*')].filter((element) => {
        const node = element as HTMLElement
        const style = getComputedStyle(node)
        return (style.overflowY === 'auto' || style.overflowY === 'scroll')
          && node.scrollHeight > node.clientHeight + 100
      }).slice(0, 4) as HTMLElement[]
      for (const element of scrollers) element.scrollTop = element.scrollHeight
    })
    await page.waitForTimeout(900)
  }
  return seen
}

export function findCardByUrn(page: Page, urn: string) {
  return page.locator(`div[data-chameleon-result-urn="${urn}"]`).first()
}

export async function extractCardFields(card: Locator): Promise<CardFields> {
  return card.evaluate((el, summarySel) => {
    const root = el as HTMLElement
    const urn = root.getAttribute('data-chameleon-result-urn') || ''
    const view = root.getAttribute('data-view-name') || ''
    const kind = urn.includes(':article:') ? 'article' : urn.includes(':activity:') ? 'activity' : 'unknown'
    const summary = root.querySelector(summarySel)
    const summaryText = summary ? (summary as HTMLElement).innerText.trim() : ''
    const hasSeeMore = [...root.querySelectorAll('button, a')].some((node) => {
      const html = node as HTMLElement
      return /see more/i.test(html.innerText || '')
        || /see more/i.test(node.getAttribute('aria-label') || '')
    })
    const update = [...root.querySelectorAll('a[href*="/feed/update/"]')]
      .map((anchor) => (anchor as HTMLAnchorElement).href)[0] || null
    const profiles = [...root.querySelectorAll('a[href*="/in/"]')]
      .map((anchor) => ({
        href: (anchor as HTMLAnchorElement).href.split('?')[0],
        text: ((anchor as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim(),
      }))
      .filter((profile) => profile.text)
    const actor = root.querySelector('.entity-result__content-actor')
    const actorText = actor ? (actor as HTMLElement).innerText.replace(/\s+/g, ' ').trim() : ''
    const embedded = root.querySelector('.entity-result__embedded-object')
    const embeddedTitle = embedded ? (embedded as HTMLElement).innerText.replace(/\s+/g, ' ').trim() : ''
    const text = (root.innerText || '').replace(/\s+/g, ' ').trim()
    const authorName = profiles[0]
      ? profiles[0].text.split('\n')[0].replace(/\s+View\b.*$/, '').trim()
      : null
    return {
      urn,
      view,
      kind,
      summary_text: summaryText,
      has_see_more: hasSeeMore,
      update_url: update,
      author_name: authorName,
      author_url: profiles[0]?.href || null,
      author_headline: null,
      actor_text: actorText,
      embedded_title: embeddedTitle,
      saved_link_label: /\bSaved link\b/i.test(text),
      has_image: !!root.querySelector('img'),
    }
  }, SUMMARY_SEL)
}

async function readSummary(card: Locator) {
  const summary = card.locator(SUMMARY_SEL).first()
  if (await summary.count() === 0) return ''
  return normalizeContent(await summary.innerText())
}

export async function expandSeeMore(card: Locator) {
  const before = await readSummary(card)
  const button = card.locator(SEE_MORE_SEL).first()
  if (await button.count() === 0) {
    return { expanded: false, summary: before, see_more_gone: true }
  }
  await button.click({ timeout: 5000 })
  await card.page().waitForTimeout(1100)
  const after = await readSummary(card)
  const still = await card.locator(SEE_MORE_SEL).count()
  return {
    expanded: true,
    summary: after || before,
    see_more_gone: still === 0,
    before_len: before.length,
    after_len: after.length,
  }
}

export async function resolveArticleDestination(context: BrowserContext, updateUrl: string) {
  const page = await context.newPage()
  try {
    await page.goto(updateUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 })
    await page.waitForTimeout(2200)
    const reason = hardStopReason(await authSignals(page))
    if (reason) return { ok: false, error: reason, destination: null, open_article_aria: null as string | null }
    const data = await page.evaluate(() => {
      const absolute = (href: string) => {
        try {
          return new URL(href, location.origin).href
        } catch {
          return href
        }
      }
      const links = [...document.querySelectorAll('a[href]')]
        .map((anchor) => ({
          href: absolute(anchor.getAttribute('href') || (anchor as HTMLAnchorElement).href),
          aria: anchor.getAttribute('aria-label') || '',
        }))
        .filter((link) => link.href && /^https?:/i.test(link.href) && !/linkedin\.com|licdn\.com|microsoft\.com/i.test(link.href))
      const openArticle = links.find((link) => link.aria.startsWith('Open article:'))
      return {
        destination: openArticle?.href || links[0]?.href || null,
        open_article_aria: openArticle?.aria || null,
      }
    })
    const destination = data.destination
    return {
      ok: Boolean(destination),
      destination,
      error: destination ? null : 'no_external_destination',
      open_article_aria: data.open_article_aria,
    }
  } catch (error) {
    return {
      ok: false,
      destination: null,
      error: error instanceof Error ? error.message : String(error),
      open_article_aria: null,
    }
  } finally {
    await page.close()
  }
}

async function ensureCardVisible(page: Page, urn: string, maxScrolls = 30) {
  for (let i = 0; i < maxScrolls; i += 1) {
    const card = findCardByUrn(page, urn)
    if (await card.count() > 0) {
      try {
        await card.scrollIntoViewIfNeeded({ timeout: 2000 })
      } catch {
        // The card can detach while the saved feed scrolls.
      }
      return card
    }
    await page.evaluate(() => window.scrollTo(0, document.body?.scrollHeight ?? 0))
    await page.waitForTimeout(1000)
  }
  return null
}

function capturedAt() {
  return new Date().toISOString()
}

export async function captureLinkedInCard(
  context: BrowserContext,
  page: Page,
  urn: string,
): Promise<LinkedInCapture> {
  const card = await ensureCardVisible(page, urn)
  const fallbackType = kindFromUrn(urn) === 'unknown' ? 'activity' : kindFromUrn(urn)
  if (!card) {
    return {
      linkedin_urn: urn,
      item_type: fallbackType,
      linkedin_url: linkedinUrlForUrn(urn),
      capture_status: 'error',
      capture_error: 'card_not_found_after_scroll',
      extracted_at: capturedAt(),
    }
  }

  const fields = await extractCardFields(card)
  const itemType = fields.kind || kindFromUrn(urn)
  if (itemType === 'unknown') {
    return {
      linkedin_urn: urn,
      item_type: 'activity',
      linkedin_url: linkedinUrlForUrn(urn),
      capture_status: 'error',
      capture_error: 'unknown_item_type',
      raw_metadata: fields,
      extracted_at: capturedAt(),
    }
  }

  let contentText = ''
  let sourceUrl: string | null = null
  let title: string | null = null
  let captureError: string | null = null

  if (itemType === 'activity') {
    if (fields.has_see_more) {
      const expanded = await expandSeeMore(card)
      contentText = normalizeContent(expanded.summary || '')
      if (!expanded.see_more_gone) captureError = 'see_more_still_present'
    } else {
      contentText = normalizeContent(fields.summary_text || '')
    }
    title = fields.embedded_title || contentText.slice(0, 120) || null
    if (title) title = title.slice(0, 200)
  } else {
    title = fields.embedded_title || null
    const updateUrl = fields.update_url || linkedinUrlForUrn(urn)
    const resolved = await resolveArticleDestination(context, updateUrl)
    if (resolved.ok && resolved.destination) {
      sourceUrl = resolved.destination
      const aria = resolved.open_article_aria || ''
      if (aria.startsWith('Open article:')) {
        title = aria.slice('Open article:'.length).split(' by ')[0].trim() || title
      }
      contentText = title || sourceUrl
    } else {
      captureError = resolved.error || 'article_resolve_failed'
    }
  }

  let status = 'error'
  if (contentText) status = 'complete'
  else if (itemType === 'activity' && fields.has_image) status = 'metadata_only'
  else if (itemType === 'article' && sourceUrl) {
    status = 'complete'
    contentText = contentText || sourceUrl
  } else {
    captureError = captureError || 'empty_content'
  }
  if (captureError && !contentText && !sourceUrl) status = 'error'

  return {
    linkedin_urn: urn,
    item_type: itemType,
    linkedin_url: linkedinUrlForUrn(urn),
    source_url: sourceUrl,
    author_name: fields.author_name,
    author_url: fields.author_url,
    author_headline: fields.author_headline,
    title,
    content_text: contentText || null,
    content_hash: contentHash(contentText),
    raw_metadata: {
      view: fields.view,
      has_see_more: fields.has_see_more,
      has_image: fields.has_image,
      saved_link_label: fields.saved_link_label,
      update_url: fields.update_url,
      capture_warning: status === 'complete' ? captureError : null,
    },
    capture_status: status,
    capture_error: status === 'error' ? captureError : null,
    extracted_at: capturedAt(),
  }
}
