/**
 * Account balance and context formatting for the pet's usage strip.
 *
 * Context comes from the per-session `contextPressure` projection the pet
 * already reads. Balance comes from the Host account Remote — the same source
 * as Settings → Account — so no API key is read or stored here.
 */

const CLIENT_VERSION = '0.2.3'
const REFRESH_MS = 60_000
const EMPTY_WALLETS = Object.freeze([])

export const EMPTY_BALANCE = Object.freeze({
  status: 'loading',
  wallets: EMPTY_WALLETS,
  updatedAt: 0,
})

export const EMPTY_BALANCE_SOURCE = Object.freeze({
  getSnapshot: () => EMPTY_BALANCE,
  subscribe: () => () => {},
  refresh: () => {},
})

/** Resolve one optional client service without making it a hard dependency. */
function optionalService(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name) : undefined
  } catch {
    return undefined
  }
}

/** The account Remote namespace, when the current composition exposes one. */
function accountOf(ctx) {
  // A plugin without an explicit `remote.account` inject gets a thrown
  // "cannot get property" from the `ctx.remote.account` accessor. The typed
  // namespace service is the supported lookup and must be tried first: an
  // earlier try/catch around the accessor would otherwise hide this service too.
  const direct = optionalService(ctx, 'remote.account')
  if (direct !== undefined && typeof direct?.getBalance === 'function') return direct
  try {
    const account = optionalService(ctx, 'remote')?.account
    return account !== undefined && typeof account?.getBalance === 'function' ? account : undefined
  } catch {
    return undefined
  }
}

/** Active UI language, with a browser fallback outside the renderer. */
function localeOf(ctx) {
  const active = optionalService(ctx, 'locale')?.getSnapshot?.()?.active
  if (typeof active === 'string' && active !== '') return active
  if (typeof navigator !== 'undefined' && typeof navigator.language === 'string' && navigator.language !== '') {
    return navigator.language
  }
  return 'zh_CN'
}

function walletOf(value, bonus) {
  if (value === null || typeof value !== 'object') return undefined
  const currency = value.currency === 'CNY' || value.currency === 'USD' ? value.currency : undefined
  const balance = Number(value.balance)
  if (currency === undefined || !Number.isFinite(balance)) return undefined
  return Object.freeze({ currency, balance, bonus })
}

function walletsOf(result) {
  const wallets = []
  for (const value of Array.isArray(result?.value) ? result.value : []) {
    const wallet = walletOf(value, false)
    if (wallet !== undefined) wallets.push(wallet)
  }
  for (const value of Array.isArray(result?.bonusWallets) ? result.bonusWallets : []) {
    const wallet = walletOf(value, true)
    if (wallet !== undefined) wallets.push(wallet)
  }
  return Object.freeze(wallets)
}

function sameWallets(left, right) {
  if (left === right) return true
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index].currency !== right[index].currency
      || left[index].balance !== right[index].balance
      || left[index].bonus !== right[index].bonus) return false
  }
  return true
}

function snapshotOf(result) {
  if (result === null || result === undefined) {
    return { status: 'signed-out', wallets: EMPTY_WALLETS, updatedAt: Date.now() }
  }
  if (result.status === 'ready') {
    return { status: 'ready', wallets: walletsOf(result), updatedAt: Date.now() }
  }
  return {
    status: result.status === 'failed' ? 'failed' : 'unavailable',
    wallets: EMPTY_WALLETS,
    updatedAt: Date.now(),
  }
}

/**
 * Create the account-balance observable consumed by the pet surface.
 * The Remote is resolved on every refresh so a late account/remote service
 * still participates; failed reads keep the strip useful with a placeholder.
 * @param ctx - plugin context.
 */
export function createAccountBalanceSource(ctx) {
  let snapshot = EMPTY_BALANCE
  let timer
  let request
  const listeners = new Set()

  const publish = next => {
    if (next.status === snapshot.status && sameWallets(next.wallets, snapshot.wallets)) return
    snapshot = next
    for (const listener of listeners) {
      try {
        listener()
      } catch {}
    }
  }

  const refresh = () => {
    if (request !== undefined) return request
    const account = accountOf(ctx)
    if (account === undefined) {
      publish({ status: 'unavailable', wallets: EMPTY_WALLETS, updatedAt: Date.now() })
      return Promise.resolve()
    }
    request = (async () => {
      try {
        const result = await account.getBalance({
          version: CLIENT_VERSION,
          locale: localeOf(ctx),
          timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
        })
        publish(result?.ok === true
          ? snapshotOf(result.value)
          : { status: 'unavailable', wallets: EMPTY_WALLETS, updatedAt: Date.now() })
      } catch {
        publish({ status: 'failed', wallets: EMPTY_WALLETS, updatedAt: Date.now() })
      } finally {
        request = undefined
      }
    })()
    return request
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      if (listeners.size === 1) {
        refresh()
        timer = setInterval(refresh, REFRESH_MS)
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          clearInterval(timer)
          timer = undefined
        }
      }
    },
    refresh,
  }
}

const SYMBOL = Object.freeze({ CNY: '¥', USD: '$' })

function formatAmount(value) {
  if (!Number.isFinite(value)) return '--'
  const abs = Math.abs(value)
  if (abs > 0 && abs < 0.01) return '<0.01'
  return abs.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Human-readable balance strip text. CNY is preferred because the pet targets
 * DeepSeek's CNY wallet; any other returned currency is shown with its own
 * symbol rather than silently converted.
 * @param balance - account balance snapshot.
 */
export function balanceSummary(balance) {
  const wallets = Array.isArray(balance?.wallets) ? balance.wallets : []
  if (balance?.status !== 'ready' || wallets.length === 0) {
    const title = balance?.status === 'signed-out'
      ? '登录 DeepSeek 账号后显示余额'
      : balance?.status === 'failed'
        ? '余额读取失败，稍后自动重试'
        : balance?.status === 'unavailable'
          ? '当前环境不支持余额查询'
          : balance?.status === 'ready'
            ? '余额暂不可用'
            : '正在读取余额'
    return { text: '¥--', title, low: false, available: false }
  }
  const cny = wallets.filter(wallet => wallet.currency === 'CNY')
  const pool = cny.length > 0 ? cny : wallets.filter(wallet => wallet.currency === wallets[0].currency)
  const currency = pool[0].currency
  const symbol = SYMBOL[currency] ?? `${currency} `
  const total = pool.reduce((sum, wallet) => sum + wallet.balance, 0)
  const topup = pool.filter(wallet => wallet.bonus !== true).reduce((sum, wallet) => sum + wallet.balance, 0)
  const bonus = pool.filter(wallet => wallet.bonus === true).reduce((sum, wallet) => sum + wallet.balance, 0)
  const text = `${total < 0 ? '-' : ''}${symbol}${formatAmount(total)}`
  const parts = []
  if (topup !== 0) parts.push(`充值 ${symbol}${formatAmount(topup)}`)
  if (bonus !== 0) parts.push(`赠金 ${symbol}${formatAmount(bonus)}`)
  return {
    text,
    title: `余额 ${text}${parts.length > 0 ? `（${parts.join(' · ')}）` : ''}`,
    low: total < 10,
    available: true,
  }
}

/**
 * Context occupancy for the strip.
 * @param tokens - used tokens, or null while the projection has no sample.
 * @param windowSize - route context window, or null when unknown.
 */
export function contextUsage(tokens, windowSize) {
  const total = Number.isFinite(tokens) && tokens >= 0 ? tokens : null
  const limit = Number.isFinite(windowSize) && windowSize > 0 ? windowSize : null
  if (total === null || limit === null) {
    return { percent: null, tone: 'unknown', title: '上下文占用尚不可用' }
  }
  const percent = Math.round(Math.min(1, total / limit) * 100)
  return {
    percent,
    tone: percent >= 90 ? 'danger' : percent >= 80 ? 'warn' : 'normal',
    title: `上下文 ${total.toLocaleString('zh-CN')} / ${limit.toLocaleString('zh-CN')} tokens（${percent}%）`,
  }
}
