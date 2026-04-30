export interface SiteContext {
  readonly url: string;
  readonly host: string;
  readonly readyState: DocumentReadyState;
}

export interface SiteHandler {
  /** ハンドラ識別用の名前 (ログ用) */
  name: string;
  /** マッチさせたいホストの集合。完全一致 or サフィックス一致で評価する */
  hosts: string[];
  /** 初回ロード時 (host 一致時) に呼ばれる */
  onLoad(ctx: SiteContext): void;
  /** SPA で URL が変化したときに呼ばれる (任意) */
  onUrlChange?(ctx: SiteContext): void;
}
