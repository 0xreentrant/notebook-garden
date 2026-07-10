import { runHeadedNotebooklmLogin } from '../src/server/notebooklm/notebooklm-login'

const cookieHeader = await runHeadedNotebooklmLogin({ interactive: true })
if (!cookieHeader) {
  console.error('NotebookLM login not detected. Open notebooklm.google.com and sign in, then resume.')
  process.exit(1)
}

console.log('NotebookLM login OK')
