export const HOME_PATH = '/summaries'

export const APP_TABS = [
  {
    path: '/summaries',
    label: 'Summaries',
    description: 'Create notebooks from YouTube summaries',
  },
  {
    path: '/bookmarks',
    label: 'Bookmarks',
    description: 'Create notebooks from Chrome bookmarks',
  },
  {
    path: '/linkedin',
    label: 'LinkedIn Saved',
    description: 'Browse captured LinkedIn Saved items',
  },
  {
    path: '/library',
    label: 'Library',
    description: 'Tend your NotebookLM garden',
  },
] as const

export type AppTabPath = (typeof APP_TABS)[number]['path']
