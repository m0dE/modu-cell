# Input Handling

Complete guide to handling keyboard and mouse input in Modu games.

## InputPlugin Setup

First, add the InputPlugin to your game:

```javascript
const input = game.addPlugin(Modu.InputPlugin, canvas);
```

## Action-Based Input (Recommended)

The recommended way to handle input is through **actions**. Actions abstract raw input into game-meaningful values that are automatically synchronized across the network.

### Registering Actions

```javascript
// Vector action for movement (WASD)
input.action('move', {
    type: 'vector',
    bindings: [() => {
        let x = 0, y = 0;
        if (input.isKeyDown('w') || input.isKeyDown('arrowup')) y -= 1;
        if (input.isKeyDown('s') || input.isKeyDown('arrowdown')) y += 1;
        if (input.isKeyDown('a') || input.isKeyDown('arrowleft')) x -= 1;
        if (input.isKeyDown('d') || input.isKeyDown('arrowright')) x += 1;
        return { x, y };
    }]
});

// Button action with key binding
input.action('split', {
    type: 'button',
    bindings: ['key: ']  // Space key
});

// Button action with key binding (letter)
input.action('toggleCamera', {
    type: 'button',
    bindings: ['key:c']
});

// Vector action for mouse target (world coordinates)
input.action('target', {
    type: 'vector',
    bindings: [() => {
        const cam = cameraEntity.get(Modu.Camera2D);
        const worldX = (mouseX - WIDTH / 2) / cam.zoom + cam.x;
        const worldY = (mouseY - HEIGHT / 2) / cam.zoom + cam.y;
        return { x: worldX, y: worldY };
    }]
});
```

### Reading Actions in Systems

In systems, read input through `game.world.getInput(clientId)`:

```javascript
game.addSystem(() => {
    for (const entity of game.query('player')) {
        const clientId = entity.get(Player).clientId;
        const playerInput = game.world.getInput(clientId);

        if (!playerInput) continue;

        // Read action values
        if (playerInput.move) {
            velocity.x = playerInput.move.x * SPEED;
            velocity.y = playerInput.move.y * SPEED;
        }

        if (playerInput.target) {
            // Move toward mouse target
            const dx = playerInput.target.x - transform.x;
            const dy = playerInput.target.y - transform.y;
            // ...
        }

        if (playerInput.split) {
            // Player pressed split
        }
    }
}, { phase: 'update' });
```

## Direct Key Checking

For checking keys directly (typically in action callbacks):

```javascript
// CORRECT - lowercase key names
input.isKeyDown('w')
input.isKeyDown('a')
input.isKeyDown('s')
input.isKeyDown('d')
input.isKeyDown('arrowup')
input.isKeyDown('arrowdown')
input.isKeyDown('arrowleft')
input.isKeyDown('arrowright')
input.isKeyDown(' ')  // Space

// WRONG - these don't work
input.isKeyDown('W')      // Wrong: uppercase
input.isKeyDown('KeyW')   // Wrong: KeyboardEvent.code format
keysDown.has('w')         // Wrong: internal API
```

### Key Names Reference

| Key | Name |
|-----|------|
| W | `'w'` |
| A | `'a'` |
| S | `'s'` |
| D | `'d'` |
| Arrow Up | `'arrowup'` |
| Arrow Down | `'arrowdown'` |
| Arrow Left | `'arrowleft'` |
| Arrow Right | `'arrowright'` |
| Space | `' '` |
| Shift | `'shift'` |
| Control | `'control'` |
| Enter | `'enter'` |
| Escape | `'escape'` |

## Local Input for Client-Side Prediction

For responsive controls, apply local input immediately in the 'input' phase:

```javascript
game.addSystem(() => {
    const localId = getLocalClientId();
    if (localId === null) return;

    // Only apply CSP if local player exists
    const localPlayer = game.world.getEntityByClientId(localId);
    if (!localPlayer || localPlayer.destroyed) return;

    // Get all input from InputPlugin
    const localInput = input.getAll();

    // Apply it to the world's input registry
    game.world.setInput(localId, localInput);
}, { phase: 'input' });
```

## Control Scheme Examples

### Twin-Stick (2D Shooter Style)
WASD moves in screen directions, mouse aims independently:

```javascript
// Movement action
input.action('move', {
    type: 'vector',
    bindings: [() => {
        let x = 0, y = 0;
        if (input.isKeyDown('w') || input.isKeyDown('arrowup')) y -= 1;
        if (input.isKeyDown('s') || input.isKeyDown('arrowdown')) y += 1;
        if (input.isKeyDown('a') || input.isKeyDown('arrowleft')) x -= 1;
        if (input.isKeyDown('d') || input.isKeyDown('arrowright')) x += 1;
        return { x, y };
    }]
});

// Aim action (normalized direction from screen center)
input.action('aim', {
    type: 'vector',
    bindings: [() => {
        const dx = mouseX - WIDTH / 2;
        const dy = mouseY - HEIGHT / 2;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        return {
            x: Math.round((dx / dist) * 1000),
            y: Math.round((dy / dist) * 1000)
        };
    }]
});

// In system:
game.addSystem(() => {
    for (const entity of game.query('player')) {
        const playerInput = game.world.getInput(entity.get(Player).clientId);
        if (!playerInput) continue;

        // Apply movement
        if (playerInput.move) {
            entity.get(Body2D).vx = playerInput.move.x * SPEED;
            entity.get(Body2D).vy = playerInput.move.y * SPEED;
        }

        // Apply rotation from aim
        if (playerInput.aim) {
            entity.get(Transform2D).rotation = Math.atan2(
                playerInput.aim.y,
                playerInput.aim.x
            );
        }
    }
}, { phase: 'update' });
```

### Tank Controls
W/S moves forward/backward relative to facing direction, A/D rotates:

```javascript
input.action('move', {
    type: 'vector',
    bindings: [() => {
        let forward = 0, turn = 0;
        if (input.isKeyDown('w')) forward = 1;
        if (input.isKeyDown('s')) forward = -1;
        if (input.isKeyDown('a')) turn = -1;
        if (input.isKeyDown('d')) turn = 1;
        return { x: forward, y: turn };  // x = forward/back, y = turn
    }]
});

// In system:
game.addSystem(() => {
    for (const entity of game.query('player')) {
        const playerInput = game.world.getInput(entity.get(Player).clientId);
        if (!playerInput?.move) continue;

        const transform = entity.get(Transform2D);
        const body = entity.get(Body2D);

        // Apply rotation
        transform.rotation += playerInput.move.y * TURN_SPEED;

        // Apply movement in facing direction
        const moveSpeed = playerInput.move.x * SPEED;
        body.vx = Math.cos(transform.rotation) * moveSpeed;
        body.vy = Math.sin(transform.rotation) * moveSpeed;
    }
}, { phase: 'update' });
```

### Point-and-Click (Mouse Target)
Click to set destination, player moves toward it:

```javascript
input.action('target', {
    type: 'vector',
    bindings: [() => {
        const cam = cameraEntity.get(Camera2D);
        const worldX = (mouseX - WIDTH / 2) / cam.zoom + cam.x;
        const worldY = (mouseY - HEIGHT / 2) / cam.zoom + cam.y;
        return { x: worldX, y: worldY };
    }]
});

// In system:
game.addSystem(() => {
    for (const entity of game.query('player')) {
        const playerInput = game.world.getInput(entity.get(Player).clientId);
        if (!playerInput?.target) continue;

        const transform = entity.get(Transform2D);
        const dx = playerInput.target.x - transform.x;
        const dy = playerInput.target.y - transform.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > DEADZONE) {
            entity.get(Body2D).vx = (dx / dist) * SPEED;
            entity.get(Body2D).vy = (dy / dist) * SPEED;
        } else {
            entity.get(Body2D).vx = 0;
            entity.get(Body2D).vy = 0;
        }
    }
}, { phase: 'update' });
```

## Common Bugs

### Bug: Input not working
**Wrong:**
```javascript
if (keysDown.has('w')) { }  // Internal API, don't use
if (input.isKeyDown('W')) { }  // Wrong: uppercase
if (input.isKeyDown('KeyW')) { }  // Wrong: code format
```
**Correct:**
```javascript
if (input.isKeyDown('w')) { }  // Lowercase
```

### Bug: Actions not being read
**Wrong:**
```javascript
const input = game.getInput();  // This doesn't exist
```
**Correct:**
```javascript
const playerInput = game.world.getInput(clientId);  // Get by client ID
```

### Bug: Diagonal movement faster
Normalize the input vector:
```javascript
if (x !== 0 && y !== 0) {
    const len = Math.sqrt(x * x + y * y);
    x /= len;
    y /= len;
}
```

## Debugging

```javascript
// Log what the InputPlugin sees
window.addEventListener('keydown', (e) => {
    console.log('key:', e.key);
    console.log('isKeyDown result:', input.isKeyDown(e.key.toLowerCase()));
    console.log('all actions:', input.getAll());
});

// Log input in system
game.addSystem(() => {
    const playerInput = game.world.getInput(clientId);
    console.log('playerInput:', playerInput);
}, { phase: 'update' });
```
