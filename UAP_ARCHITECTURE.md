# Universal Agent Protocol (UAP) - v10.0 Architecture

## Overview

The Universal Agent Protocol (UAP) enables Sentinel Override v10.0 to serve as a universal browser automation backend for external AI frameworks, CI/CD systems, and multi-agent networks.

## Core Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Sentinel Override v10.0                       │
│                  (Universal Agent Protocol)                      │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   UAP Server │    │   UAP Client │    │  Federation  │
│   (WebSocket)│    │   (JS SDK)   │    │   Layer      │
└──────────────┘    └──────────────┘    └──────────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ LangChain    │    │  AutoGPT     │    │   CrewAI     │
│  Bridge      │    │  Bridge      │    │   Bridge     │
└──────────────┘    └──────────────┘    └──────────────┘
```

## Components

### 1. UAP Server (background/uap-server.js)

**Purpose**: WebSocket server that accepts external goal requests and streams execution results.

**Protocol**: JSON-based WebSocket messages with bidirectional streaming.

**Message Types**:
```javascript
// Client → Server
{
  "type": "goal_request",
  "id": "uuid",
  "goal": "string",
  "context": {
    "tenant": "optional",
    "client_id": "optional",
    "budget": 100,
    "mode": "turbo|normal|stealth"
  },
  "webhook": "optional_url_for_completion"
}

// Server → Client (streaming)
{
  "type": "step_update",
  "id": "uuid",
  "step": 1,
  "total": 10,
  "action": "click",
  "target": "element_description",
  "screenshot": "base64_or_url"
}

// Server → Client (completion)
{
  "type": "goal_complete",
  "id": "uuid",
  "status": "success|failed|paused",
  "result": {
    "summary": "string",
    "findings": [],
    "evidence": {},
    "trust_score": 85
  },
  "metrics": {
    "duration_ms": 45000,
    "steps": 10,
    "tokens_used": 12500,
    "failures": 0
  }
}

// Server → Client (error)
{
  "type": "error",
  "id": "uuid",
  "error": "error_type",
  "message": "Human-readable message",
  "recoverable": true
}
```

**Security Features**:
- Token-based authentication (API keys or JWT)
- Origin validation for web clients
- Rate limiting per token
- Tenant lockdown enforcement
- Sensitive-field protection always active
- MFA pause automatic
- Audit logging for all requests

### 2. JavaScript Client SDK (lib/uap-client.js)

**Purpose**: Browser/Node.js client library for connecting to UAP Server.

**API Design**:
```javascript
import { UAPClient } from '@sentinel-override/uap-client';

const client = new UAPClient({
  serverUrl: 'ws://localhost:8000/uap',
  authToken: 'your_api_key',
  timeout: 300000 // 5 minutes default
});

// Execute goal with streaming updates
const run = await client.execute({
  goal: 'Pull user sign-in events from Entra',
  context: {
    tenant: 'acme.onmicrosoft.com',
    client_id: 'client-123',
    budget: 150
  },
  onStep: (step) => {
    console.log(`Step ${step.step}/${step.total}: ${step.action}`);
  },
  onComplete: (result) => {
    console.log('Done:', result.summary);
    console.log('Trust score:', result.trust_score);
  },
  onError: (error) => {
    console.error('Failed:', error.message);
  }
});

// Pause execution
await run.pause();

// Resume execution
await run.resume();

// Cancel execution
await run.cancel();

// Get current status
const status = await run.getStatus();
// => { running: true, step: 5, total: 12, paused: false }
```

**Features**:
- Automatic reconnection with exponential backoff
- Request queuing when disconnected
- Bidirectional streaming
- Timeout handling
- Cancellation support
- TypeScript definitions
- Browser and Node.js compatible

### 3. Federation Layer (background/federation.js)

**Purpose**: Zero-trust multi-agent coordination for agent swarms and collaborative workflows.

**Architecture**:
```
┌─────────────────────────────────────────────────┐
│            Federation Controller                │
│  - Peer discovery                               │
│  - Trust score aggregation                      │
│  - Work distribution                            │
│  - Result reconciliation                        │
└─────────────────────────────────────────────────┘
         │                    │                    │
    ┌────▼────┐          ┌────▼────┐         ┌────▼────┐
    │ Agent A │          │ Agent B │         │ Agent C │
    │ Trust: 85│         │ Trust: 92│         │ Trust: 78│
    └─────────┘          └─────────┘         └─────────┘
```

**Key Concepts**:

**Peer Discovery**: Agents register on WebSocket with public key:
```javascript
{
  "type": "register_peer",
  "peer_id": "ed25519_public_key",
  "capabilities": ["vision", "network", "knowledge_graph"],
  "max_concurrent_goals": 3,
  "trust_score_baseline": 85
}
```

**Work Distribution**:
- Federation controller accepts large goal
- Decomposes into sub-goals using LLM
- Distributes to capable peers based on:
  - Current load
  - Trust score
  - Capability match
  - Tenant affinity (for M365 work)

**Result Reconciliation**:
- All peer results collected
- Cross-validation for consistency
- Trust score adjusted based on result quality
- Consensus building for conflicting claims

**Zero-Trust Security**:
- All peers authenticate with Ed25519 keys
- Messages signed and verified
- No implicit trust — trust score earned over time
- Audit trail for all peer interactions
- Automatic isolation of low-trust peers

**Trust Score Calculation**:
```
baseline_score (from historical performance)
+ completion_rate_bonus (up to +10)
+ result_quality_bonus (up to +15)
+ security_compliance_bonus (up to +10)
- failure_rate_penalty (up to -20)
- security_violation_penalty (up to -30)
= final_peer_trust_score
```

### 4. Framework Bridges

#### LangChain Bridge (lib/bridges/langchain.js)

**Integration Pattern**:
```python
from langchain.agents import AgentExecutor
from langchain.tools import Tool
from sentinel_override import UAPTool

# Sentinel Override as LangChain tool
uap_tool = Tool(
    name="sentinel_browser",
    description="Execute browser automation goals with vision-based agent. "
                "Input: goal string. Output: execution result with evidence.",
    func=lambda goal: UAPTool.execute(goal)
)

agent = AgentExecutor.from_agent_and_tools(
    agent=llm_agent,
    tools=[uap_tool, other_tools],
    verbose=True
)

result = agent.invoke({
    "input": "Investigate the Entra sign-in logs for suspicious patterns"
})
```

#### AutoGPT Bridge (lib/bridges/autogpt.js)

**Integration Pattern**:
```python
from autogpt.agent import Agent
from sentinel_override.autogpt_bridge import UAPCommand

# Sentinel Override as AutoGPT command
agent = Agent(
    commands=[
        UAPCommand(),
        # other commands
    ],
    config={
        "uap_server_url": "ws://localhost:8000/uap",
        "uap_auth_token": os.getenv("SENTINEL_TOKEN")
    }
)

# AutoGPT can now call browser operations
agent.run(
    "Navigate to the admin portal and extract all users with admin privileges"
)
```

#### CrewAI Bridge (lib/bridges/crewai.js)

**Integration Pattern**:
```python
from crewai import Agent, Task, Crew
from sentinel_override.crewai_bridge import uap_tool

researcher = Agent(
    role='Web Researcher',
    goal='Gather intelligence from web portals',
    tools=[uap_tool],  # Sentinel Override integration
    llm=llm
)

task = Task(
    description="Investigate the security logs and identify anomalies",
    agent=researcher,
    expected_output="Structured report with evidence citations"
)

crew = Crew(agents=[researcher], tasks=[task])
result = crew.kickoff()
```

### 5. CI/CD Integration Hooks

#### GitHub Actions (.github/workflows/sentinel-test.yml)

```yaml
name: Sentinel E2E Test

on:
  pull_request:
    paths:
      - 'admin-portal/**'
      - 'frontend/**'

jobs:
  sentinel-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Start Sentinel Override
        run: |
          # Load Chrome extension
          google-chrome --load-extension=./sentinel-override-extension &
          SENTINEL_PID=$!
          
          # Wait for UAP server ready
          curl --retry 10 --retry-delay 5 http://localhost:8000/health
          
      - name: Run Sentinel Goal
        uses: sentinel-override/action@v1
        with:
          goal: |
            Login to admin portal with ${{ secrets.ADMIN_CREDS }}
            Navigate to user management
            Create test user e2e-test-${{ github.run_number }}
            Verify user appears in list
            Delete test user
          expected: "user created and deleted successfully"
          
      - name: Assert Success
        run: |
          if [ "$SENTINEL_STATUS" != "success" ]; then
            echo "Sentinel test failed: $SENTINEL_ERROR"
            exit 1
          fi
```

#### GitLab CI (.gitlab-ci.yml)

```yaml
sentinel_e2e:
  stage: test
  script:
    - ./scripts/start-sentinel.sh
    - ./scripts/run-sentinel-goal.sh "Login and verify dashboard loads"
    - ./scripts/assert-sentinel-success.sh
  artifacts:
    reports:
      sentinel: sentinel-report.json
```

#### Azure DevOps Pipeline

```yaml
- task: SentinelOverride@1
  inputs:
    serverUrl: 'ws://localhost:8000/uap'
    authToken: '$(SENTINEL_TOKEN)'
    goal: 'Run full smoke test on staging environment'
    timeout: 600
    screenshotDir: '$(Build.ArtifactStagingDirectory)/screenshots'
```

### 6. Federation Security

**Authentication Flow**:
```
1. Client connects with: { auth_token, client_id, timestamp }
2. Server validates token signature and expiration
3. Server generates session ID with Ed25519 keypair
4. Client proves possession by signing challenge
5. Session established with encrypted channel
```

**Authorization Model**:
- **Token Scopes**: `read:status`, `execute:goal`, `admin:federation`
- **Tenant Restrictions**: Tokens scoped to specific tenants for M365 work
- **Rate Limits**: Per-token quotas (e.g., 100 goals/hour)
- **IP Whitelisting**: Optional IP-based access control

**Audit Logging**:
```javascript
{
  "timestamp": "2026-06-04T12:34:56Z",
  "event_type": "goal_request",
  "client_id": "ci-cd-pipeline-42",
  "token_id": "tok_abc123",
  "goal": "Login and check dashboard",
  "tenant": "acme.onmicrosoft.com",
  "context": {
    "user_agent": "Sentinel-CI/1.0",
    "origin_ip": "10.0.0.5"
  },
  "result": "success",
  "duration_ms": 45000,
  "trust_score": 92
}
```

**Security Controls**:
1. **Tenant Lockdown**: All M365 operations respect expectedTenant
2. **Sensitive-Field Protection**: Always active, no bypass
3. **MFA Auto-Pause**: Triggers on 12 authentication patterns
4. **Configuration Verification**: Blocks false-positive completion
5. **Hallucination Hard-Stop**: Validates claim vs evidence density
6. **Rate Limiting**: Prevents abuse and token exhaustion
7. **Peer Isolation**: Low-trust federation peers isolated

## Implementation Plan (Phase 6)

### Step 1: UAP Server Implementation
- [ ] Create background/uap-server.js
- [ ] Implement WebSocket server
- [ ] Add message handlers (goal_request, status, cancel)
- [ ] Integrate with existing agent-engine.js
- [ ] Add authentication middleware
- [ ] Add rate limiting
- [ ] Add audit logging
- [ ] Unit tests

### Step 2: JavaScript SDK
- [ ] Create lib/uap-client.js
- [ ] Implement WebSocket client
- [ ] Add reconnection logic
- [ ] Add streaming support
- [ ] Add pause/resume/cancel
- [ ] Add TypeScript definitions
- [ ] Browser compatibility tests
- [ ] Node.js compatibility tests

### Step 3: Federation Layer
- [ ] Create background/federation.js
- [ ] Implement peer discovery
- [ ] Implement work distribution
- [ ] Implement result reconciliation
- [ ] Add Ed25519 crypto
- [ ] Add trust score calculation
- [ ] Add peer isolation
- [ ] Federation tests

### Step 4: Framework Bridges
- [ ] Create lib/bridges/langchain.js
- [ ] Create lib/bridges/autogpt.js
- [ ] Create lib/bridges/crewai.js
- [ ] Add example notebooks
- [ ] Add integration tests

### Step 5: CI/CD Hooks
- [ ] Create GitHub Action
- [ ] Create GitLab CI template
- [ ] Create Azure DevOps task
- [ ] Add documentation
- [ ] Add example workflows

### Step 6: Security & Testing
- [ ] Implement all security controls
- [ ] Add comprehensive test suite
- [ ] Security audit
- [ ] Performance testing
- [ ] Load testing

### Step 7: Production Readiness
- [ ] Update manifest.json to v10.0
- [ ] Update package.json dependencies
- [ ] Create migration guide
- [ ] Create rollback plan
- [ ] Update documentation
- [ ] Final testing

## Success Criteria

- [ ] UAP server accepts and executes goals via WebSocket
- [ ] JavaScript SDK connects and streams results
- [ ] Federation layer coordinates multiple agents
- [ ] All framework bridges functional
- [ ] CI/CD hooks passing in example repos
- [ ] All security controls active
- [ ] 100% of tests passing
- [ ] Performance acceptable (<5s cold start, <2s response)
- [ ] Security validated (no critical vulnerabilities)
- [ ] Complete documentation
- [ ] Migration guide created
- [ ] Rollback plan documented

## Migration Path from v4.0.2 to v10.0

1. **Backup current extension** (Export settings and client knowledge)
2. **Install v10.0** (Load unpacked or update from store)
3. **Import settings** (Restore from backup)
4. **Verify existing functionality** (Run smoke tests)
5. **Enable UAP server** (Settings → Advanced → Universal Protocol)
6. **Generate auth token** (For external integrations)
7. **Test framework bridge** (Run example notebook)
8. **Configure CI/CD hook** (Add to pipeline)
9. **Monitor performance** (Check telemetry)
10. **Rollback if needed** (Follow rollback plan)

## Rollback Plan

**Trigger Conditions**:
- Critical security vulnerability discovered
- Performance degradation >50%
- Breaking change in existing workflows
- Data loss or corruption
- <95% test pass rate

**Rollback Steps**:
1. **Disable UAP server** (Settings → Advanced → Disable)
2. **Uninstall v10.0** (chrome://extensions → Remove)
3. **Reinstall v4.0.2** (Load unpacked backup)
4. **Import settings** (Restore from backup)
5. **Verify restoration** (Run smoke tests)
6. **File incident report** (Document root cause)
7. **Plan fix** (Create hotfix branch)

**Data Protection**:
- Client knowledge exported before upgrade
- Settings backed up locally
- Extension data preserved in chrome.storage
- Rollback restores all data from backup

---

*Architecture Document: Universal Agent Protocol v10.0*
*Author: Sentinel Override Phase 6 Executor*
*Date: 2026-06-04*
