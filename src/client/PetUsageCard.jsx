import { balanceSummary, contextUsage } from './pet-usage.js'

/**
 * Compact context + account-balance strip replacing the focused-session title.
 * The title attribute carries the exact token counts and the top-up/bonus split.
 */
export function PetUsageCard({ contextTokens, contextWindow, balance, sessionLabel }) {
  const context = contextUsage(contextTokens, contextWindow)
  const money = balanceSummary(balance)
  const title = [context.title, money.title, sessionLabel].filter(Boolean).join(' · ')
  return (
    <div className="dsh-live2d-usage" data-tone={context.tone} title={title} aria-label={title}>
      <div className="dsh-live2d-usage-row">
        <span className="dsh-live2d-usage-context">上下文 {context.percent === null ? '--' : `${context.percent}%`}</span>
        <span className="dsh-live2d-usage-balance" data-low={money.low ? 'true' : 'false'}>余额 {money.text}</span>
      </div>
      <div className="dsh-live2d-usage-track" aria-hidden="true">
        <i style={{ width: `${context.percent ?? 0}%` }} />
      </div>
    </div>
  )
}
