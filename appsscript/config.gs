const CONFIG = {
  RSS_URL: 'https://itunes.apple.com/in/rss/customerreviews/page={PAGE}/id=1404871703/sortby=mostrecent/json',
  APP_ID_IOS: '1404871703',
  PLAY_PACKAGE: 'com.nextbillion.groww',
  GEMINI_URL: 'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent',
  GEMINI_MODEL: 'gemini-3.5-flash-lite',
  GEMINI_KEY_PROP: 'GEMINI_API_KEY',
  GEMINI_RETRY_MAX: 3,
  GEMINI_RETRY_DELAY_MS: 3000,
  NOTE_WORD_LIMIT: 250,
  THEMES: [
    { name: 'App Stability', keywords: ['crash','freezing','lag','hang','slow','bug','glitch','stuck','error','not opening','closes','closes','loading','stucks','screen','performance','update broke','after update','battery','latency','delay','timeout','blank','not loading','unresponsive','keeps stopping'] },
    { name: 'Order Execution', keywords: ['order','buy','sell','share','trade','execution','limit order','market order','pending','not executed','rejected','slippage','position','intraday','delivery','blocked order','qty','lot','stoploss','bracket','unfilled','failed order','order failed'] },
    { name: 'Withdrawals & Funds', keywords: ['withdraw','withdrawal','money','fund','amount','deposit','bank','transfer','upi','settlement','credit','refund','not credited','deduction','charges cut','wallet','balance','pending withdrawal','money stuck','nfss'] },
    { name: 'Customer Support', keywords: ['support','customer care','service','response','call','email','contact','complaint','agent','follow up','pending complaint','chatbot','help','not responding','no reply','unhelpful'] },
    { name: 'Account & Security', keywords: ['login','account','password','otp','authentication','banned','blocked account','security','verification','profile','pan','email change','phone change','closed account','access','sign in','2fa','suspended','deactivated'] }
  ],
  TAB_NAMES: {
    RAW: 'RawReviews',
    THEMES: 'Themes',
    NOTE_HISTORY: 'NoteHistory',
    RUN_LOG: 'RunLog',
    VERIFICATION: 'Verification'
  },
  RAW_COLS: ['date','platform','rating','title','text','theme'],
  THEME_COLS: ['theme','count','avg_rating','priority_score','rank','top_quote','top_quote_rating','action_idea'],
  NOTE_HISTORY_COLS: ['generated_at','theme1','theme2','theme3','note_text','word_count','email_subject','status'],
  RUN_LOG_COLS: ['timestamp','stage','status','detail'],
  VERIFICATION_COLS: ['check','status','detail']
};

function prop(key, fallback) {
  return PropertiesService.getScriptProperties().getProperty(key) || fallback;
}
