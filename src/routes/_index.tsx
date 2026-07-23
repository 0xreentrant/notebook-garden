import { redirect } from 'react-router'
import { HOME_PATH } from '@/lib/app-tabs'

export function clientLoader() {
  return redirect(HOME_PATH)
}

clientLoader.hydrate = true as const

export default function IndexRoute() {
  return null
}
