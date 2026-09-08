import { AGENTS } from '../../utils/constants'
import Icon from '../Icon/Icon'

/**
 * Multi-agent execution bar.
 * Built and ready for future workflow integration.
 * Currently hidden via the `hidden` prop / Workspace spacer.
 */
function AgentExecutionBar({ agentStates = {}, hidden = true }) {
  if (hidden) return null

  return (
    <div className="border-b border-border bg-card/90 px-4 py-2.5 backdrop-blur-sm sm:px-6">
      <div className="mx-auto flex max-w-[1600px] items-center gap-2 overflow-x-auto">
        {AGENTS.map((agent, index) => {
          const state = agentStates[agent.id] || 'pending'
          const isLast = index === AGENTS.length - 1

          return (
            <div key={agent.id} className="flex min-w-0 items-center gap-2">
              <div
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 transition-all duration-300 ${
                  state === 'completed'
                    ? 'border-accent/40 bg-accent/10 text-accent'
                    : state === 'running'
                      ? 'agent-pulse border-accent/50 bg-accent/5 text-accent'
                      : 'border-border bg-panel text-ink-muted'
                }`}
              >
                <span
                  className={`grid h-5 w-5 place-items-center rounded-full ${
                    state === 'completed'
                      ? 'bg-accent text-white'
                      : state === 'running'
                        ? 'border border-accent/60'
                        : 'border border-border'
                  }`}
                >
                  {state === 'completed' ? (
                    <Icon name="check" className="h-3 w-3" />
                  ) : state === 'running' ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                  ) : null}
                </span>
                <span className="whitespace-nowrap text-xs font-medium sm:text-sm">
                  {agent.label}
                </span>
              </div>

              {!isLast && (
                <div
                  className={`h-px w-6 shrink-0 rounded-full sm:w-8 ${
                    state === 'completed' || state === 'running'
                      ? 'agent-connector'
                      : 'bg-border'
                  }`}
                  aria-hidden="true"
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default AgentExecutionBar
