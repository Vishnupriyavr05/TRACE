import QueryInput from './QueryInput'
import SourceUpload from './SourceUpload'
import Filters from './Filters'
import SortBy from './SortBy'
import RecentSearches from './RecentSearches'
import PanelScroll from '../PanelScroll/PanelScroll'

function ResearchWorkspace({
  query,
  onQueryChange,
  onTrace,
  isRunning,
  files,
  onFilesChange,
  filters,
  onFiltersChange,
  sortBy,
  onSortByChange,
  recentSearches,
}) {
  return (
    <aside className="flex h-full min-h-0 flex-col rounded-2xl border border-border bg-card shadow-sm">
      <div className="shrink-0 border-b border-border px-4 py-3">
        <h2 className="font-serif text-lg font-semibold text-ink">Research Workspace</h2>
      </div>

      <PanelScroll className="min-h-0 flex-1 space-y-6 px-4 py-4">
        <QueryInput
          value={query}
          onChange={onQueryChange}
          onSubmit={onTrace}
          isRunning={isRunning}
        />
        <SourceUpload files={files} onFilesChange={onFilesChange} />
        <Filters filters={filters} onChange={onFiltersChange} />
        <SortBy value={sortBy} onChange={onSortByChange} />
        <RecentSearches searches={recentSearches} onSelect={onQueryChange} />
      </PanelScroll>
    </aside>
  )
}

export default ResearchWorkspace
