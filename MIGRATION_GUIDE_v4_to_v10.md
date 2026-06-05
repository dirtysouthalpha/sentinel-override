# Migration Guide: v4.0.2 → v10.0

This guide walks you through upgrading Sentinel Override from v4.0.2 to v10.0 with the Universal Agent Protocol.

## Overview

v10.0 introduces the **Universal Agent Protocol (UAP)**, enabling Sentinel Override to serve as a universal browser automation backend for external frameworks, CI/CD systems, and multi-agent networks.

### Key Changes in v10.0

- **UAP Server**: WebSocket-based server for external goal execution
- **JavaScript SDK**: Client library for web/Node.js applications
- **Federation Layer**: Zero-trust multi-agent coordination
- **Framework Bridges**: LangChain, AutoGPT, CrewAI integrations
- **CI/CD Hooks**: GitHub Actions, GitLab CI, Azure DevOps
- **Enhanced Security**: Token-based auth, rate limiting, audit logging

## Prerequisites

- Current version: v4.0.2
- Chrome/Edge browser with Manifest V3 support
- Admin rights to install extensions
- Backup of existing settings (recommended)

## Migration Steps

### Step 1: Backup Current Configuration

Before upgrading, export your current settings:

1. Open Sentinel Override side panel
2. Click **Settings** (⚙️)
3. Scroll to **Data Management**
4. Click **Export All Data**
5. Save the JSON file to a safe location

This backup includes:
- Provider configurations
- API keys
- Client knowledge
- Platform profile customizations
- Theme settings

### Step 2: Uninstall v4.0.2

1. Open `chrome://extensions`
2. Find "Sentinel Override"
3. Click **Remove**
4. Confirm removal

**Note**: Your chrome.storage data is preserved by Chrome automatically.

### Step 3: Install v10.0

#### Option A: Chrome Web Store (Recommended)

1. Visit Chrome Web Store (link will be available after v10.0 release)
2. Click **Add to Chrome**
3. Confirm installation

#### Option B: Load Unpacked (Developer Mode)

1. Download v10.0 release from [GitHub Releases](https://github.com/dirtysouthalpha/sentinel-override/releases)
2. Extract the archive
3. Open `chrome://extensions`
4. Enable **Developer mode**
5. Click **Load unpacked**
6. Select the extracted directory

### Step 4: Import Settings

1. Open Sentinel Override v10.0
2. Click **Settings** (⚙️)
3. Scroll to **Data Management**
4. Click **Import Data**
5. Select your backup JSON file from Step 1
6. Confirm import

### Step 5: Verify Existing Functionality

Test that existing v4.0.2 features still work:

1. **Provider Test**:
   - Open Settings → Provider Catalog
   - Click a provider (e.g., OpenAI)
   - Verify your API key is present
   - Click **Detect Models** - should see model list

2. **Basic Goal Test**:
   ```
   Navigate to example.com and verify the page loads
   ```
   - Should see orange cursor movement
   - Should complete with "page loads" in summary

3. **M365 Tenant Test** (if using M365):
   - Set expectedTenant in Settings
   - Run goal targeting your tenant
   - Verify green tenant chip appears

### Step 6: Enable UAP Server (Optional)

The UAP server is **disabled by default**. Enable it to use framework bridges:

1. Open **Settings** → **Advanced**
2. Find **Universal Agent Protocol**
3. Toggle **Enable UAP Server**
4. Configure options:
   - Port: 8765 (default)
   - Max connections: 100
   - Rate limit: 100 requests/hour per token
5. Click **Save**

### Step 7: Generate Auth Token

For external integrations, you need an auth token:

1. In **Settings** → **Advanced** → **UAP Configuration**
2. Click **Generate Auth Token**
3. Copy the token (shown once)
4. Store securely - this is your API key for external apps

### Step 8: Test Framework Bridge (Optional)

Test your preferred framework integration:

#### LangChain Test

```python
# Install: pip install sentinel-override
from sentinel_override import SentinelTool

tool = SentinelTool(
    server_url='ws://localhost:8765/uap',
    auth_token='your_token_here'
)

result = tool.execute('Navigate to example.com')
print(result.summary)
```

#### AutoGPT Test

```python
# Install: pip install sentinel-autogpt
from autogpt import Agent
from sentinel_autogpt import SentinelCommand

agent = Agent(
    commands=[SentinelCommand()],
    config={'uap_token': 'your_token_here'}
)

agent.run('Check example.com and tell me what you see')
```

#### CrewAI Test

```python
# Install: pip install sentinel-crewai
from crewai import Agent, Tool
from sentinel_crewai import create_sentinel_tool

tool = create_sentinel_tool({
    'server_url': 'ws://localhost:8765/uap',
    'auth_token': 'your_token_here'
})

agent = Agent(
    role='Web Researcher',
    tools=[tool],
    llm=your_llm
)
```

### Step 9: Configure CI/CD Hook (Optional)

#### GitHub Actions

Add to `.github/workflows/sentinel-test.yml`:

```yaml
- name: Run Sentinel Test
  uses: sentinel-override/action@v1
  with:
    goal: 'Navigate to admin portal and verify dashboard'
    token: ${{ secrets.SENTINEL_TOKEN }}
```

#### GitLab CI

Add to `.gitlab-ci.yml`:

```yaml
sentinel_test:
  script:
    - npm install -g @sentinel-override/cli
    - sentinel test --goal "Test admin portal" --token $SENTINEL_TOKEN
```

### Step 10: Monitor Performance

After migration, monitor for:

1. **Extension performance**:
   - Side panel should load in <2s
   - Goals should start executing in <3s
   - Memory usage should be <500MB

2. **UAP server health**:
   - Check Settings → Advanced → UAP Statistics
   - Monitor active connections
   - Review audit log for errors

3. **Test results**:
   - All 5,517 existing tests should pass
   - New UAP tests should pass
   - No regressions in existing workflows

## Troubleshooting

### Issue: Extension won't load

**Solution**:
1. Check Chrome version (need 88+)
2. Verify Manifest V3 is supported
3. Check chrome://extensions for errors
4. Try reloading the extension

### Issue: Settings import fails

**Solution**:
1. Verify backup JSON is valid
2. Check file permissions
3. Try importing individual sections
4. Manually reconfigure if needed

### Issue: UAP server won't start

**Solution**:
1. Check if port 8765 is available
2. Verify firewall isn't blocking
3. Check chrome://extensions for errors
4. Review UAP audit log

### Issue: Framework bridge can't connect

**Solution**:
1. Verify UAP server is enabled
2. Check auth token is valid
3. Test connection with `ping()`
4. Review firewall rules

### Issue: Tests failing after migration

**Solution**:
1. Run `npm test` to see specific failures
2. Check if tests need v10.0 API updates
3. Review breaking changes in CHANGELOG
4. Update test assertions for new behavior

## Rollback Procedure

If you encounter critical issues:

1. **Disable UAP server**:
   - Settings → Advanced → Disable UAP Server

2. **Uninstall v10.0**:
   - chrome://extensions → Remove

3. **Reinstall v4.0.2**:
   - Load unpacked from v4.0.2 backup

4. **Import settings**:
   - Use your backup from Step 1

5. **Verify restoration**:
   - Run smoke tests
   - Check all providers work
   - Verify M365 tenant detection

6. **Report issue**:
   - File bug on GitHub with details
   - Include error logs and reproduction steps

## Breaking Changes

### API Changes

- `executeGoal()` now returns a Promise (was callback-based)
- `onStep` callback structure changed (added `total` field)
- `trustScore` renamed to `trust_score` in results

### Removed Features

- Old WebSocket protocol (replaced by UAP)
- Legacy provider format (use new registry)

### New Requirements

- Auth tokens required for UAP access
- Rate limits enforced by default
- Audit logging always active

## Feature Compatibility

### v4.0.2 Features in v10.0

| Feature | Status | Notes |
|---------|--------|-------|
| Vision-first SoM overlays | ✅ Compatible | No changes |
| 16+ provider support | ✅ Compatible | Auto-detection improved |
| Tenant lockdown | ✅ Compatible | Enhanced with UAP |
| MFA auto-pause | ✅ Compatible | 12 patterns active |
| Configuration verification | ✅ Compatible | No changes |
| Source-cited outputs | ✅ Compatible | Format unchanged |
| Client knowledge | ✅ Compatible | Storage unchanged |
| 19 platform profiles | ✅ Compatible | All active |
| Macro recorder | ✅ Compatible | No changes |
| Trust score | ✅ Compatible | Calculation enhanced |

### New v10.0 Features

| Feature | Description |
|---------|-------------|
| UAP Server | WebSocket-based goal execution API |
| JavaScript SDK | Client library for web/Node.js |
| Federation Layer | Multi-agent coordination |
| LangChain Bridge | Integration with LangChain |
| AutoGPT Bridge | Integration with AutoGPT |
| CrewAI Bridge | Integration with CrewAI |
| CI/CD Hooks | GitHub, GitLab, Azure DevOps |
| Enhanced Security | Token auth, rate limiting |

## Performance Impact

### Expected Changes

- **Cold start**: +200ms (UAP initialization)
- **Memory**: +50MB (UAP server + federation)
- **CPU**: <1% increase when idle

### Optimization Tips

1. Disable UAP if not using framework bridges
2. Adjust rate limits for high-volume usage
3. Limit federation peers to 10-20 for most use cases
4. Use turbo mode for CI/CD automation

## Support

If you encounter issues:

1. Check this guide's troubleshooting section
2. Review [CHANGELOG.md](./CHANGELOG.md) for known issues
3. Search [GitHub Issues](https://github.com/dirtysouthalpha/sentinel-override/issues)
4. File new issue with:
   - Chrome version
   - Sentinel version
   - Error logs
   - Reproduction steps

## Summary

Migrating from v4.0.2 to v10.0 involves:

1. ✅ Back up settings (5 min)
2. ✅ Uninstall v4.0.2 (2 min)
3. ✅ Install v10.0 (3 min)
4. ✅ Import settings (2 min)
5. ✅ Verify functionality (10 min)
6. ✅ Enable UAP server (optional, 5 min)
7. ✅ Test framework bridges (optional, 15 min)

**Total time**: 27-42 minutes

The migration is designed to be **non-destructive** - your v4.0.2 data is preserved and can be restored if needed.

---

*Migration Guide: v4.0.2 → v10.0*  
*Last updated: 2026-06-04*  
*For questions, open an issue on GitHub*
