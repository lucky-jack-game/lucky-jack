// 進捗表(RoundScoreboard)が読む「これまでの局」の記録。
//
// **3つの画面（オンライン・CPU練習・実践チュートリアル）が同じものを使う。** 記録の作り方を
// 画面ごとに書くと、片方だけ列がずれるような食い違いが必ず出る——このリポジトリが繰り返し
// 踏んできた形なので、最初から1つにしておく。
//
// 局番号は**配列の長さから決める**（1局につき必ず1回開示が来るので、prev.length + 1 が局番号）。
// 開示のペイロードに局番号は載っていないうえ、Socket.ioのハンドラから局番号のstateを読むと
// マウント時点の値を掴む（stale closure）——更新関数の中だけで完結させれば、どちらの問題も起きない。
import { useCallback, useState } from "react";

export function useRoundLog() {
  const [log, setLog] = useState([]);
  const push = useCallback((reveal) => {
    if (!reveal) return;
    setLog((prev) => [...prev, {
      round: prev.length + 1,
      // **中身は開示のペイロードそのまま。** ここで勝敗を計算し直さないこと（判定は状態機械が
      // 済ませてあり、2箇所で決めると必ず食い違う）。
      yourCard: reveal.yourCard ?? null,
      opponentCard: reveal.opponentCard ?? null,
      kjMode: reveal.kjMode ?? null,
      youWonPot: !!reveal.youWonPot,
      youWonCard: !!reveal.youWonCard,
      folded: !!reveal.folded,
    }]);
  }, []);
  const reset = useCallback(() => setLog([]), []);
  return { log, pushRound: push, resetLog: reset };
}
