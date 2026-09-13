import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// 入り口はこれ1つ。以前あった検証用のクエリ分岐（?proto3d=1 の3D検証、?trailer=1 のトレーラー
// 書き出し、ルール移行中の暫定入り口）は、いずれも役目を終えたので撤去した。
// **検証用の分岐を足したら、確認が済み次第その場で消すこと**——残しておくと、本番導線には
// 出ないまま参照だけが生き続けて、撤去のたびに巻き添えで壊れる。
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
