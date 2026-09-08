import { Link } from 'react-router-dom'

/**
 * Shared layout for Login / Register pages.
 */
function AuthLayout({ title, subtitle, children }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-surface text-ink">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(79,124,255,0.14),_transparent_55%),linear-gradient(180deg,#eef4ff_0%,#f8fafc_42%,#f8fafc_100%)] dark:bg-[radial-gradient(ellipse_at_top,_rgba(91,134,255,0.16),_transparent_50%),linear-gradient(180deg,#0b1220_0%,#0f172a_100%)]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:linear-gradient(to_right,rgba(15,23,42,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.04)_1px,transparent_1px)] [background-size:28px_28px] dark:opacity-20 dark:[background-image:linear-gradient(to_right,rgba(241,245,249,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(241,245,249,0.05)_1px,transparent_1px)]"
        aria-hidden="true"
      />

      <div className="relative mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-4 py-10 sm:px-6">
        <div className="mb-8 text-center">
          <Link to="/login" className="inline-flex flex-col items-center gap-3">
            <img
              src="/assets/logo.png"
              alt="TRACE"
              className="h-12 w-auto object-contain sm:h-14"
            />
            <span className="font-serif text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              TRACE
            </span>
          </Link>
          <p className="mt-2 text-sm text-ink-muted">
            Tracing Research Across Connected Evidence &amp; Reasoning
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card/95 p-6 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-sm sm:p-8 dark:shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
          <div className="mb-6">
            <h1 className="font-serif text-2xl font-semibold tracking-tight text-ink">
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
                {subtitle}
              </p>
            ) : null}
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}

export default AuthLayout
