import { useLang } from "../lib/i18n";
import { CardFace } from "./Card";
import { Button, Modal } from "./ui";

const ZH = [
  ["目标", "最先出完手牌的人获胜。"],
  [
    "两种牌",
    "普通牌（纯色牌面）永远正面朝上打出；说谎牌（黑底霓虹边、带面具标记）永远背面朝上打出，并且要大声说出它是什么。全部 112 张：每种颜色的 0–9 各有一张普通牌和一张说谎牌；跳过、反转、+2 和变色 +4 全是说谎牌；6 张说谎挑战是普通牌。",
  ],
  ["出牌", "与顶牌颜色、数字或符号相同即可出。没有能出的牌（或者不想出）就摸一张，摸到能出的牌可以立刻打出。"],
  [
    "说谎牌",
    "说谎牌匹配时就说实话；不匹配时可以撒谎，但谎话必须合理 —— 只能声称一张能接在顶牌上的牌（同色、同数字/符号，或者变色 +4）。",
  ],
  [
    "质疑",
    "暗出后其他人都可以质疑。说真话 → 质疑者罚摸 1 张；说谎 → 收回那张牌并罚摸 1 张，效果作废。没人质疑，就按声明生效，包括行动牌的效果。",
  ],
  ["普通牌暗出", "规则禁止把普通牌当说谎牌暗出，一旦被质疑抓到，收回并罚摸 6 张（房间可关闭此玩法）。"],
  ["7 换手 · 0 传牌", "出 7 必须和任意一名玩家交换手牌；出 0 所有人按当前方向把手牌传给下家。7/0 被质疑时，罚牌在换手之后摸。"],
  ["行动牌", "+2：下家摸 2 张并跳过；反转：改变方向（两人时等同跳过）；跳过：下家跳过；变色 +4：任意时候可出，下家摸 4 张并跳过，你选颜色。"],
  [
    "说谎挑战",
    "正面打出并指定颜色。其他人各自背面放一张牌并声称是该颜色（没有就只能虚张）。你可以逐个质疑：说谎者收回并罚摸 1 张；一旦亮出真的该颜色，或已全部质疑，或你主动结束，该玩家和所有没被质疑的人把牌压到挑战牌下。借此出完的人获胜，可以多人一起赢。",
  ],
  ["UNO", "手牌只剩 1 张时要喊 UNO（剩 2 张时可以先喊）。在下一位玩家行动前被别人抓到，罚摸 2 张。"],
  ["获胜与计分", "最后一张牌没被质疑（或质疑后证明是真话）就赢。累计计分时，数字牌按面值，跳过/反转/+2 为 20 分，万能牌 50 分。"],
];

const EN = [
  ["Goal", "Be the first to get rid of all your cards."],
  [
    "Two kinds of cards",
    "Regular Cards (solid faces) are always played face up. Liar's Cards (dark, neon-edged, mask emblem) are always played face down while you say what they are. 112 cards: every 0–9 in each color comes once as Regular and once as Liar's; all Skip, Reverse, Draw Two and Wild Draw 4 cards are Liar's Cards; the 6 Wild Liar's Challenge cards are Regular.",
  ],
  ["Playing", "Match the top card by color, number or symbol. If you can't (or don't want to), draw one card — you may play it right away if it's playable."],
  ["Liar's Cards", "A matching Liar's Card is played honestly. A non-matching one can be played with a lie — but the lie must be plausible: something that could legally go on the top card (same color, same number/symbol, or Wild Draw 4)."],
  ["Challenging", "Anyone may challenge a face-down card. Truth → the challenger draws 1. Lie → you take the card back and draw 1, and its effect is cancelled. If nobody challenges, the claim stands — action effects included."],
  ["Regular cards face down", "Passing a Regular Card off as a Liar's Card is forbidden: if you're caught, take it back and draw 6 (rooms can disable this)."],
  ["7 swap · 0 pass", "Playing a 7 means swapping hands with a player of your choice. Playing a 0 makes everyone pass their hand along the direction of play. When a 7 or 0 is challenged, the penalty card is drawn after the exchange."],
  ["Action cards", "Draw Two: next player draws 2 and loses their turn. Reverse: direction flips (acts as Skip with 2 players). Skip: next player loses their turn. Wild Draw 4: playable on anything; next player draws 4 and loses their turn; you pick the color."],
  [
    "Wild Liar's Challenge",
    "Played face up; choose a color. Everyone else puts one card face down claiming it's that color (bluffing if they must). Challenge them one by one: liars take their card back and draw 1. As soon as someone reveals the true color, or everyone has been challenged, or you stop, that player and all unchallenged players slip their cards under the Challenge card. Anyone who empties their hand this way wins — even several at once.",
  ],
  ["UNO", "Call UNO when you're down to one card (you can call it at two). If someone catches you before the next player acts, draw 2."],
  ["Winning & scoring", "Your last card wins if it isn't challenged (or survives the challenge). In score mode: numbers at face value, Skip/Reverse/Draw Two 20, wilds 50."],
];

export function RulesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { lang, t } = useLang();
  const rows = lang === "zh" ? ZH : EN;
  return (
    <Modal open={open} onClose={onClose} className="rules-modal" labelledBy="rules-title">
      <div className="rules-head">
        <h2 id="rules-title">{t.rules}</h2>
        <div className="rules-cards">
          <div className="mini-card">
            <CardFace card={{ color: "blue", value: "7", liar: false }} />
          </div>
          <div className="mini-card">
            <CardFace card={{ color: "blue", value: "7", liar: true }} />
          </div>
          <div className="mini-card">
            <CardFace card={{ color: null, value: "wlc", liar: false }} />
          </div>
        </div>
      </div>
      <dl className="rules-list">
        {rows.map(([k, v]) => (
          <div key={k} className="rules-row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="modal-actions">
        <Button variant="primary" onClick={onClose}>
          {t.close}
        </Button>
      </div>
    </Modal>
  );
}
