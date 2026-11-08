# Agents — two parallel Claude Code sessions

Read CLAUDE.md first. Each session owns its folders; they meet at the checkpoints.

## Session A — Pipeline (pipeline/, assets/, GLBs in web/public/)
| By (PT) | Deliver |
|---|---|
| 11:45 | body.glb with morph targets body_0..body_5, at Caleb's default body |
| 12:45 | tee / sweater / pants GLBs, same skeleton + transferred body morphs |
| 1:20 | clean fit: no spikes, no poke-through, sleeves follow arms (posed render check) |
| 1:40 | freeze |

## Session B — App (web/, api/)
| By (PT) | Deliver |
|---|---|
| 11:45 | viewer: body.glb (placeholder until it lands), orbit, 3 scenes, auto-rotate default |
| 12:45 | catalog.json (6 items), picker, /api/product working or paste-JSON fallback |
| 1:20 | garment rebind by bone name, tint, morph sliders drive body + garments |
| 1:40 | /api/photoreal + button; deployed to Vercel |

## Handoffs
- A drops GLBs into web/public/; B's dev server picks them up on reload.
- A contract change = edit CLAUDE.md in the same commit and say so.
- Small commits to main; pull before each commit.

## Checkpoints
11:45 body in viewer · 12:45 garments + links · 1:20 full outfit + sliders · 1:40 live + photoreal ·
1:40-1:55 record demo · 2:05 post in #i-shipped.
