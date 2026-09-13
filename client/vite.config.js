import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react()],
  // GitHub Pages は https://<ユーザー名>.github.io/<リポジトリ名>/ の下で配信する。
  // ビルドだけ相対パスにしておけば、リポジトリ名がどうなっても書き換えずに動く。
  // （public/ の画像をコードから参照するときは import.meta.env.BASE_URL を前に付けること）
  base: command === 'build' ? './' : '/',
  server: {
    fs: {
      // ../shared/（engine.js・match.js＝ルール本体）をdev serverから読めるようにする
      allow: ['..'],
    },
  },
}))
