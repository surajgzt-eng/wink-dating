# Telegram Dating Bot — Process Flow

Last updated: 2026-06-17
Stack: Node.js + Express + SQLite/PostgreSQL + Telegram Bot API + WebApp Mini App
Status: Backend live (`http://localhost:3000`), stubbed face-verification, stubbed PayPal

---

## 1. System Architecture (high-level)

```mermaid
flowchart LR
    User([👤 User in Telegram])
    TG[Telegram Bot API]
    Bot[Bot Polling/ Webhook handler]
    Express[Express server.js]
    DB[(SQLite / PostgreSQL)]
    LLM[Colab DeepSeek-R1<br/>face verification]
    PayPal[PayPal API]
    WebApp[WebApp<br/>MiniApp in Telegram]
    User -->|Opens bot| TG
    TG -->|updates| Bot
    Bot -->|HTTP| Express
    Express <-->|queries| DB
    Express -.->|verify photo| LLM
    Express -.->|checkout| PayPal
    Express -->|HTML/JS| WebApp
    WebApp -->|JWT-auth API calls| Express
```

---

## 2. Onboarding Flow (the 18-step spec)

```mermaid
flowchart TD
    Start([/start]) --> NewUser{Existing<br/>user?}
    NewUser -- no --> Q1
    NewUser -- yes --> MainMenu

    Q1[/What's your name?/] --> A1[Save first_name]
    A1 --> Q2[/Age?/]
    Q2 --> A2[Save age]
    A2 --> Q3[/City?/]
    Q3 --> A3
    A3 --> Q4[/Country?/]
    Q4 --> A4
    A4 --> Q5[/Gender?<br/>♂ / ♀ / ⚧/]
    Q5 --> A5
    A5 --> Q6[/Looking for?<br/>♂ / ♀ / Any/]
    Q6 --> A6[is_premium women: free forever]
    A6 --> Q7[/Upload photo/]

    Q7 -->|photo URL| V{LLM face<br/>verify}
    V -->|≥ 70% match| Verified[Set is_verified=1]
    V -->|< 70% / fail| Reject[Ask for clearer photo]
    Reject --> Q7

    Verified --> SetupBtn[/Start Matching/]
    SetupBtn --> MatchEngine

    MainMenu[Main menu keyboard] --> MatchEngine
```

Question texts auto-disappear after answer (`deleteMessage` on each transition).

---

## 3. Matching Sequence

```mermaid
sequenceDiagram
    autonumber
    actor U as User (28M)
    participant T as Telegram
    participant B as Bot
    participant E as Express
    participant D as Database
    participant L as LLM (face-verify)

    U->>T: /start
    T->>B: webhook update
    B->>E: POST /api/auth/register {chatId}
    E->>D: INSERT user (verified=0)
    E-->>B: JWT token

    B->>U: name? (delete on answer)
    U-->>B: "Suraj"
    Note over B,U: profile is built question-by-question

    B->>U: photo?
    U-->>B: photo URL
    B->>E: POST /api/profile/:chatId/photo
    E->>L: verifyFace(ref_url, uploaded_url)
    L-->>E: { similarity: 0.92 }
    E->>D: UPDATE is_verified = 1
    E-->>B: ok

    B->>U: "Start Matching ✅"
    U->>B: click "Find Matches"
    B->>E: POST /api/matching/find {chatId}
    E->>D: SELECT … WHERE gender=female<br/>AND age < 28 AND is_verified=1<br/>AND NOT in matches …<br/>ORDER BY RANDOM() LIMIT 1
    D-->>E: row (Eve, 26, F)
    E->>D: INSERT match
    E-->>B: {match: Eve}
    B->>U: match card + Open Chat button
```

---

## 4. Chat & Paywall State Machine

```mermaid
stateDiagram-v2
    [*] --> FreeUser: register

    FreeUser --> Premium: subscribe (₹399)
    FreeUser --> FemalePremium: female user<br/>(automatic, free life)

    Premium --> [*]

    FreeUser --> OutOfTexts: 10 texts sent
    OutOfTexts --> ReferralShown: ask "refer or pay"
    OutOfTexts --> PaywallShown: ask "refer or pay"

    ReferralShown --> FreeUser: friend buys premium<br/>+10 texts credited
    ReferralShown --> OutOfTexts: friend didn't buy<br/>(no credit)

    PaywallShown --> FemalePremium: female<br/>(always free)
    PaywallShown --> Premium: pay ₹399

    FreeUser --> FreeUser: send text<br/>(texts_used += 1)

    state match {
        [*] --> Active
        Active --> Active: send/receive
        Active --> Ended: report/block
    }
```

---

## 5. Premium Subscribe (PayPal) Sequence

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant W as WebApp
    participant E as Express
    participant P as PayPal
    participant D as DB

    U->>W: tap "Upgrade to Premium"
    W->>E: POST /api/premium/create-order {chatId}
    E->>P: POST /v2/checkout/orders<br/>{amount: 399, currency: INR}
    P-->>E: {orderId, approvalUrl}
    E-->>W: {orderId, approvalUrl}
    W->>U: redirect to PayPal
    U->>P: approve + authorize
    P->>E: webhook {event: CHECKOUT.ORDER.APPROVED}
    E->>P: POST /v2/checkout/orders/{id}/capture
    P-->>E: {status: COMPLETED}
    E->>D: UPDATE is_premium=1
    E-->>U: push notif "Premium active ✅"
```

> **Note**: PayPal integration is currently **stubbed** — `/api/premium/subscribe` auto-activates premium in dev. Real flow above requires `PAYPAL_CLIENT_ID` + `PAYPAL_CLIENT_SECRET` and webhook route mounted.

---

## 6. Referral Lifecycle

```mermaid
flowchart LR
    A[Alice generates<br/>t.me/bot?start=ref_REF_A]
    A --> B[Bob joins via link]
    B --> C[Bot stores referred_by=Alice]
    C --> D{Bob buys premium?}
    D -- yes --> E[Alice +10 texts credited<br/>notify Alice]
    D -- no  --> F[No credit<br/>(link expires)]
```

---

## 7. End-to-end request route (data path)

```mermaid
flowchart LR
    Telegram[Telegram update] --> Webhook[/webhook endpoint/]
    Webhook --> Router[Express router]
    Router --> Service[Service class]
    Service --> Query[db_adapter.query]
    Query --> SQLite[(SQLite better-sqlite3)]
    Query -->|alt: PG mode| Postgres[(PostgreSQL Pool)]
    Service --> Response[JSON response]
    Response --> TelegramApi[api.telegram.org sendMessage]
    TelegramApi --> UserChat([User chat])
```

---

## 8. File-to-feature map

```mermaid
flowchart LR
    subgraph src
        index.js --> server
        api_server_js[api/server.js]
        db_adapter[db_adapter.js]
        services_Auth[AuthService.js]
        services_Profile[ProfileService.js]
        services_Match[MatchingService.js]
        services_Chat[ChatService.js]
        services_Pay[PaymentService.js]
        services_Ref[ReferralService.js]
        services_Notif[NotificationService.js]
        services_Face[FaceVerificationService.js]
    end

    server --> db_adapter
    server --> services_Auth
    server --> services_Profile
    server --> services_Match
    server --> services_Chat
    server --> services_Pay
    server --> services_Ref
    server --> services_Notif
    services_Face -.->|not yet called| server
```
