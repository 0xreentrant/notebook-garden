import { runHeadedNotebooklmLogin } from '../src/server/notebooklm/notebooklm-login'

const cookieHeader = await runHeadedNotebooklmLogin({ interactive: true })
if (!cookieHeader) {
  console.error(`NotebookLM login not detected. Open ${process.env.NOTEBOOKLM_BASE_URL ?? 'https://notebook.google.com'} and sign in, then resume.`)
  process.exit(1)
}

console.log('NotebookLM login OK')
