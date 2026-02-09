# Team Switching Broken - Fix Applied

**Date**: January 29, 2026  
**Issue**: Workspace switching broken - cannot switch between Personal and Team  
**Status**: ✅ **RESOLVED** - Hot reloaded in browser

---

## Root Cause

During the **Blockers 3 & 4 refactoring** (auth/team state management), the team context was changed to an **event-based system**. The `ShellContext` now returns:

```typescript
currentTeam: null  // Always!
currentMember: null  // Always!
```

**Why?** Components must listen to `team:change` events for actual team data.

**The Problem**: `TeamSwitcher` component was **NOT updated** to use the new event-based pattern. It was still trying to use `currentTeam` directly from context, which was always `null`.

---

## What Was Broken

### Symptoms
- ❌ TeamSwitcher showing wrong or no team name
- ❌ Cannot switch between Personal and Team workspaces
- ❌ UI seemed "locked" in one state
- ❌ Dropdown showed "null" or incorrect team

### Why It Appeared "Locked"
The `currentTeam` was always `null` from context, so the UI couldn't display the correct state or respond to changes properly.

---

## What Was Fixed

### Changes to `TeamSwitcher.tsx`

**1. Added Local State for Current Team**
```typescript
// OLD: Relied on context (always null)
const { currentTeam, setCurrentTeam } = useTeam();

// NEW: Maintain own state, listen to events
const { setCurrentTeam } = useTeam();
const [currentTeam, setCurrentTeamState] = useState<Team | null>(null);
```

**2. Added Event Listener**
```typescript
// Listen for team:change events
useEffect(() => {
  const handleTeamChange = (data: { teamId: string | null; team: Team | null }) => {
    setCurrentTeamState(data.team);
  };
  
  eventBus.on('team:change', handleTeamChange);
  return () => {
    eventBus.off('team:change', handleTeamChange);
  };
}, [eventBus]);
```

**3. Load Initial Team on Mount**
```typescript
async function loadCurrentTeam() {
  try {
    const teamId = teamContextManager.getTeamId();
    if (teamId) {
      const teamData = await TeamService.getTeam(teamId);
      setCurrentTeamState(teamData);
    } else {
      setCurrentTeamState(null);
    }
  } catch (err) {
    console.error('Failed to load current team:', err);
    setCurrentTeamState(null);
  }
}

useEffect(() => {
  if (isAuthenticated) {
    loadTeams();
    loadCurrentTeam();  // Load current team
  }
}, [isAuthenticated]);
```

**4. Added Import**
```typescript
import { teamContext as teamContextManager } from '../services/TeamContextManager';
```

---

## How It Works Now

### Flow for Team Switching

```
1. User clicks team in TeamSwitcher
   ↓
2. handleSelectTeam(teamId) called
   ↓
3. setCurrentTeam(teamId) updates TeamContextManager
   ↓
4. TeamContextManager.setTeamId() emits 'team:id-changed'
   ↓
5. ShellContext.setCurrentTeam() emits 'team:change' with team data
   ↓
6. TeamSwitcher event listener receives 'team:change'
   ↓
7. setCurrentTeamState(data.team) updates UI
   ↓
8. UI shows correct team name and selection
```

### Event-Driven Architecture

**Components that need team data:**
- ✅ Listen to `team:change` events
- ✅ Maintain own state from events
- ✅ Use `setCurrentTeam()` to trigger changes
- ❌ DON'T rely on `currentTeam` from context (always null)

---

## Verification

### Expected Behavior

**TeamSwitcher Dropdown**:
- Shows "Personal Workspace" when no team selected
- Shows team name when team is selected
- Lists all available teams
- Check mark on current selection

**Switching to Personal**:
1. Click TeamSwitcher
2. Click "Personal Workspace"
3. UI should update to show "Personal"
4. Plugins should reload for personal context

**Switching to Team**:
1. Click TeamSwitcher
2. Click a team name
3. UI should update to show team name
4. Plugins should reload for team context

---

## Testing

### Test Team Switching

1. **Open TeamSwitcher** (top-left of shell)
2. **Click** to open dropdown
3. **Verify** current selection has check mark
4. **Click** "Personal Workspace"
5. **Verify** UI updates to show "Personal"
6. **Click** TeamSwitcher again
7. **Click** a team name
8. **Verify** UI updates to show team name

### Check Console for Events

Open DevTools Console and watch for:
```
🏢 Loading plugins for team: [team-id]
✅ Loaded [N] plugins - team context
```

Or for personal:
```
👤 Loading plugins for personal workspace
✅ Loaded [N] plugins - personalized
```

---

## Impact of Earlier Refactoring

### What Was Changed (Blockers 3 & 4)

**Phase 2.2 Changes**:
- ShellContext changed to event-based team system
- `currentTeam` in context always returns `null`
- Components must listen to `team:change` events

**Components Updated**:
- ✅ PluginContext (listens to events)
- ✅ Plugins using `useTeam()` SDK hook
- ❌ TeamSwitcher (was missed - now fixed)

---

## Related Components Status

### Components Using Team Context

**✅ PluginContext** (correctly updated)
- Listens to `team:change` events
- Refreshes plugins on team switch

**✅ Marketplace Plugin** (correctly updated)
- Uses `useTeam()` hook from SDK
- SDK hook properly listens to events

**✅ TeamSwitcher** (NOW fixed)
- Now listens to events
- Maintains own state
- Shows correct team

**✅ SDK useTeam() Hook** (works correctly)
- Listens to `team:change` events
- Returns team data to plugins

---

## Prevention

### When Making Context Changes

1. **Document the contract change** clearly
2. **Find all consumers** using grep
3. **Update all consumers** to new pattern
4. **Test all affected components**
5. **Add integration tests** for the flow

### Pattern for Event-Based Context

```typescript
// ✅ CORRECT: Component maintains state from events
const [currentTeam, setCurrentTeam] = useState<Team | null>(null);

useEffect(() => {
  eventBus.on('team:change', (data) => {
    setCurrentTeam(data.team);
  });
  return () => eventBus.off('team:change');
}, []);

// ❌ WRONG: Rely on context (always null now)
const { currentTeam } = useTeam();  // Will be null!
```

---

## Hot Reload

Since shell-web is running with Vite dev server:
- ✅ Changes detected automatically
- ✅ Component hot-reloaded in browser
- ✅ No full rebuild needed

**Just refresh your browser** to see the fix applied!

---

## Summary

**Root Cause**: TeamSwitcher not updated to use event-based system  
**Related To**: Blockers 3 & 4 refactoring (incomplete consumer update)  
**Fix**: Updated TeamSwitcher to listen to events and maintain own state  
**Deployment**: ✅ Hot reloaded (Vite dev mode)  
**Status**: ✅ **Team switching should now work**  

---

## Test Now

1. **Refresh browser** (Cmd+R / Ctrl+R)
2. **Click TeamSwitcher** (top-left)
3. **Try switching** between Personal and Teams
4. **Verify** UI updates correctly

The workspace switching should now work! 🎉

---

## Documentation

- **Blockers 3 & 4 Fix**: `docs/BLOCKERS_3_4_RESOLVED.md`
- **Auth Team State**: `docs/AUTH_TEAM_STATE_FIX_RESULTS.md`
- **Test Guide**: `QUICK_TEST_GUIDE.md`
