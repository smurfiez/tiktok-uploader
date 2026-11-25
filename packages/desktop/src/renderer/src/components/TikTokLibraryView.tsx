import { useState } from 'react'
import type { AccountLibrary, AccountSummary, RemoteVideoStatus, TikTokVideo } from '@tiktok-uploader/core'
import {
  CookieIcon,
  ExternalLinkIcon,
  EyeIcon,
  FilmIcon,
  HeartIcon,
  LogInIcon,
  MessageIcon,
  RefreshIcon,
  SearchIcon
} from './Icons'

const STUDIO_URL = 'https://www.tiktok.com/tiktokstudio/content'

const STATUS_LABEL: Record<RemoteVideoStatus, string> = {
  published: 'Published',
  scheduled: 'Scheduled',
  draft: 'Draft',
  private: 'Private',
  processing: 'Processing',
  unknown: 'Unknown'
}

type Filter = 'all' | 'published' | 'scheduled' | 'private' | 'draft'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'published', label: 'Published' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'private', label: 'Private' },
  { value: 'draft', label: 'Draft' }
]

function compact(n: number): string {
  const scaled = (v: number) => v.toFixed(1).replace(/\.0$/, '')
  if (n >= 1_000_000) return `${scaled(n / 1_000_000)}M`
  if (n >= 1_000) return `${scaled(n / 1_000)}K`
  return String(n)
}

function duration(sec: number): string {
  const total = Math.round(sec)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function day(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { dateStyle: 'medium' })
}

function syncedLabel(fetchedAt?: string): string {
  if (!fetchedAt) return 'Not synced yet'
  const d = new Date(fetchedAt)
  if (Number.isNaN(d.getTime())) return 'Not synced yet'
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60_000))
  if (mins < 1) return 'Synced just now'
  if (mins < 60) return `Synced ${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `Synced ${hours}h ago`
  return `Synced ${Math.round(hours / 24)}d ago`
}

function dateLine(item: TikTokVideo): string {
  if (item.status === 'scheduled' && item.scheduledAt) return `Scheduled · ${day(item.scheduledAt)}`
  if (item.createdAt) return `Posted · ${day(item.createdAt)}`
  if (item.scheduledAt) return `Scheduled · ${day(item.scheduledAt)}`
  return 'No date'
}

export interface TikTokLibraryViewProps {
  account: AccountSummary
  library: AccountLibrary | null
  syncing: boolean
  hasMore?: boolean
  onSync: () => void
  onLoadMore?: () => void
  onSignIn: () => void
  onImportCookies: () => void
}

export function TikTokLibraryView({
  account,
  library,
  syncing,
  hasMore,
  onSync,
  onLoadMore,
  onSignIn,
  onImportCookies
}: TikTokLibraryViewProps) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const items = library?.items ?? []
  const query = search.trim().toLowerCase()
  const filtered = items.filter(
    (item) =>
      (filter === 'all' || item.status === filter) &&
      (!query || item.caption.toLowerCase().includes(query))
  )
  const countOf = (value: Filter) =>
    value === 'all' ? items.length : items.filter((item) => item.status === value).length

  const openStudio = () => void window.api.openExternal(STUDIO_URL)

  let body
  if (syncing && !library) {
    body = (
      <div className="library-grid" aria-busy="true" aria-label="Syncing videos">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="library-skeleton" />
        ))}
      </div>
    )
  } else if (!library && !account.signedIn) {
    body = (
      <div className="empty-state">
        <h3>Sign in to view your TikTok videos</h3>
        <p className="hint">The library reads your own TikTok Studio content from this account's session.</p>
        <div className="empty-actions">
          <button type="button" className="btn primary" onClick={onSignIn}>
            <LogInIcon />
            Sign In
          </button>
          <button type="button" className="btn" onClick={onImportCookies}>
            <CookieIcon />
            Import Chrome Cookies
          </button>
        </div>
      </div>
    )
  } else if (!library) {
    body = (
      <div className="empty-state">
        <h3>No videos synced yet</h3>
        <p className="hint">
          Sync pulls your published, scheduled and draft videos straight from TikTok Studio and caches them locally.
        </p>
        <div className="empty-actions">
          <button type="button" className="btn primary" onClick={onSync}>
            <RefreshIcon />
            Sync My TikTok Videos
          </button>
        </div>
      </div>
    )
  } else if (!filtered.length) {
    body = (
      <div className="empty-state">
        <h3>{items.length ? 'No videos match your filter' : 'No videos found on this TikTok account'}</h3>
        <p className="hint">{items.length ? 'Try a different status or search term.' : 'Post a video first, then sync again.'}</p>
      </div>
    )
  } else {
    body = (
      <div className="library-grid">
        {filtered.map((item) => (
          <article key={item.id} className="library-card">
            <div className="library-poster">
              {item.coverUrl || item.thumbnailDataUrl ? (
                <img src={item.coverUrl ?? item.thumbnailDataUrl} alt="" loading="lazy" />
              ) : (
                <FilmIcon size={28} />
              )}
              <span className={`status-pill ${item.status}`}>{STATUS_LABEL[item.status]}</span>
              {item.durationSec && item.durationSec > 0 ? (
                <span className="duration-chip">{duration(item.durationSec)}</span>
              ) : null}
            </div>
            <div className="library-card-body">
              <div
                className="library-caption"
                title={item.caption}
                style={{
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden'
                }}
              >
                {item.caption || <span className="hint">No caption</span>}
              </div>
              <div className="library-date">{dateLine(item)}</div>
              <div className="library-metrics">
                <span className="metric" title={`${item.views ?? 0} views`}>
                  <EyeIcon size={13} />
                  {compact(item.views ?? 0)}
                </span>
                <span className="metric" title={`${item.likes ?? 0} likes`}>
                  <HeartIcon size={13} />
                  {compact(item.likes ?? 0)}
                </span>
                <span className="metric" title={`${item.comments ?? 0} comments`}>
                  <MessageIcon size={13} />
                  {compact(item.comments ?? 0)}
                </span>
              </div>
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => void window.api.openExternal(item.url)}
              >
                <ExternalLinkIcon size={13} />
                Open on TikTok
              </button>
            </div>
          </article>
        ))}
      </div>
    )
  }

  return (
    <div className="library-view">
      <div className="library-toolbar">
        <label className="library-search">
          <SearchIcon size={14} />
          <input
            type="search"
            placeholder="Search captions…"
            aria-label="Search videos"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="filter-pills">
          {FILTERS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className="option-pill"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label} ({countOf(value)})
            </button>
          ))}
        </div>
        <span className="spacer" />
        <span className="hint">{syncedLabel(library?.fetchedAt)}</span>
        <button type="button" className="btn" onClick={openStudio}>
          <ExternalLinkIcon />
          Open Studio
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={syncing || account.locked}
          title={account.locked ? 'This profile is in use by another run' : undefined}
          onClick={onSync}
        >
          <RefreshIcon />
          {syncing ? 'Syncing…' : 'Sync Videos'}
        </button>
        {hasMore ? (
          <button
            type="button"
            className="btn"
            disabled={syncing || account.locked}
            onClick={onLoadMore}
          >
            Load more
          </button>
        ) : null}
      </div>
      {body}
    </div>
  )
}
