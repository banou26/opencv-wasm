import { css } from '@emotion/react'

export const styles = css`
  :root { color-scheme: dark; font-family: 'DM Sans Variable', sans-serif; color: #e0e7df; background: #101310; font-synthesis: none; }
  * { box-sizing: border-box; } html, body, #root { width: 100%; height: 100%; margin: 0; overflow: hidden; } [hidden] { display: none !important; } .app-shell { height: 100dvh; display: flex; flex-direction: column; overflow: hidden; } .app-shell > :not(.workspace) { flex-shrink: 0; } button, input, select, a { -webkit-tap-highlight-color: transparent; } button, input, select { font: inherit; }
  button, select, .button { color: #d7dfd5; background: #252c25; border: 1px solid #394338; border-radius: 5px; padding: 7px 11px; font-size: 12px; cursor: pointer; transition: background .12s, border-color .12s; }
  button:hover:not(:disabled), .button:hover { background: #344032; border-color: #758b6e; } button:disabled, select:disabled, input:disabled { opacity: .42; cursor: default; }
  button.primary { background: #b5d49c; color: #172113; border-color: #b5d49c; font-weight: 700; } button.primary:hover:not(:disabled) { background: #c9e8b0; }
  button.active { border-color: #b5d49c; color: #c5e7ae; background: #293526; } button.quiet { background: transparent; border-color: transparent; }
  button.danger { color: #efbf92; border-color: #815e3e; } input[type=number] { min-width: 0; color: #e7ece4; background: #151a15; border: 1px solid #384136; border-radius: 4px; padding: 6px; font: 12px 'JetBrains Mono', monospace; }
  input[type=range] { accent-color: #b5d49c; height: 5px; cursor: pointer; } input[type=checkbox] { accent-color: #b5d49c; }
  button:focus-visible, input:focus-visible, select:focus-visible, a:focus-visible { outline: 2px solid #c5e7ae; outline-offset: 3px; }
  h1, h2, p { margin: 0; } h1, h2 { font-size: 21px; font-weight: 500; letter-spacing: -.6px; } code, .eyebrow { font-family: 'JetBrains Mono', monospace; }
  code { font-size: 11px; } .eyebrow { font-size: 9px; letter-spacing: 1.7px; color: #9caa94; font-weight: 500; white-space: nowrap; } .muted { color: #99a393; } .button { text-decoration: none; white-space: nowrap; }
  .app-header { min-height: 48px; padding: 6px 16px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #30382d; }
  .docs-link { color: #c5e7ae; text-decoration: none; white-space: nowrap; font-size: 12px; padding: 6px; }
  .brand { display: flex; align-items: center; gap: 13px; } .brand strong { font-size: 24px; letter-spacing: -1px; font-weight: 650; } .brand-mark { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border: 1px solid #8fa77b; color: #c5e7ae; font-size: 27px; border-radius: 8px; line-height: 1; padding-bottom: 6px; } .brand-mark span { color: #efbc7b; }
  .brand-divider { width: 1px; height: 20px; background: #3c4436; margin: 0 4px; } .header-actions { display: flex; align-items: center; gap: 8px; } .engine-state { font-size: 11px; color: #969f90; margin-right: 14px; display: flex; gap: 7px; align-items: center; } .engine-state i, footer i { width: 6px; height: 6px; border-radius: 50%; display: inline-block; background: #e4b886; } .engine-state.online i, footer i.ready { background: #b5d49c; }
  .source-strip { display: flex; align-items: center; gap: 16px; padding: 8px 16px; background: #191f18; border-bottom: 1px solid #30382d; } .clip-controls { display: flex; gap: 8px; } .clip-info { display: flex; flex: 1; min-width: 0; align-items: center; gap: 12px; font-size: 12px; } .clip-info strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .clip-info span { flex-shrink: 0; } .clip-controls { min-width: 0; } .source-strip > button { flex-shrink: 0; } .clip-info span { color: #a0ad98; } b { font-weight: 400; margin: 0 9px; color: #62705b; }
  .info-banner, .error-banner { padding: 12px 25px; font-size: 12px; line-height: 1.65; border-bottom: 1px solid #505240; background: #2b3022; color: #cdd2b8; } .error-banner { display: flex; align-items: center; gap: 15px; color: #eccab2; background: #33291f; border-color: #68523b; overflow-wrap: anywhere; } .error-banner span { flex: 1; }
  .workspace { display: grid; flex: 1; min-height: 0; min-width: 0; border-bottom: 1px solid #394232; }
  .graph-panel { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: #151914; overflow: hidden; } .panel-heading { padding: 10px 16px; min-height: 65px; flex-shrink: 0; display: flex; justify-content: space-between; align-items: center; gap: 12px; } .panel-heading h1, .panel-heading h2 { margin-top: 5px; } .template-label { display: flex; flex-direction: column; gap: 5px; font-size: 10px; color: #99a88d; }
  .graph-surface { position: relative; flex: 1; min-height: 0; overflow: hidden; }
  .graph-help { position: absolute; bottom: 19px; right: 15px; max-width: calc(100% - 72px); font-size: 10px; color: #9caa94; background: #171d16e8; padding: 6px 9px; border-radius: 4px; pointer-events: none; } .graph-bottom { padding: 5px 12px; display: flex; flex-shrink: 0; gap: 12px; align-items: center; border-top: 1px solid #30382d; font-size: 10px; } .graph-bottom span { display: flex; align-items: center; gap: 6px; } .graph-bottom span:last-child { margin-left: auto; } .graph-bottom i { width: 5px; height: 5px; border-radius: 50%; }
  .react-flow { --xy-background-color: transparent; --xy-controls-button-background-color: #252c25; --xy-controls-button-background-color-hover: #344032; --xy-controls-button-color: #cfdfc7; --xy-controls-button-border-color: #45503c; }
  .react-flow__controls { box-shadow: none; border: 1px solid #3a4533; border-radius: 5px; overflow: hidden; margin: 15px; }
  .react-flow__edge { cursor: pointer; }
  .react-flow__edge-path { stroke-width: 1.7; transition: stroke-width .1s, filter .1s; }
  .react-flow__edge:hover .react-flow__edge-path, .react-flow__edge.selected .react-flow__edge-path { stroke-width: 3.5; filter: drop-shadow(0 0 3px #c5e7ae99); }
  .edge-tools { position: absolute; bottom: 15px; right: 15px; max-width: calc(100% - 72px); display: flex; align-items: center; gap: 8px; padding: 7px 9px; border: 1px solid #718361; border-radius: 5px; background: #171d16f5; color: #c5e7ae; font-size: 10px; }
  .edge-tools button { font-size: 10px; padding: 4px 7px; }
  .react-flow__node { border-radius: 9px; } .operation { width: 230px; border: 1px solid #485340; border-radius: 8px; background: #22291f; box-shadow: 0 7px 16px #0003; color: #dbe6d3; } .operation.chosen { border-color: #c5e7ae; box-shadow: 0 0 0 1px #b5d49c, 0 8px 20px #0005; }
  .node-drag-handle { cursor: grab; user-select: none; } .react-flow__node.dragging .node-drag-handle { cursor: grabbing; }
  .operation-head > div { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .operation-head .op-symbol, .operation-head .status-dot { flex-shrink: 0; }
  .node-help { flex-shrink: 0; width: 23px; height: 23px; padding: 0; border-color: transparent; background: transparent; color: #a9bd99; font-size: 17px; cursor: help; }
  .node-help[aria-expanded=true] { color: #ddf4cb; background: #35452c; border-color: #718361; }
  .node-description { position: fixed; z-index: 1000; width: 350px; max-width: calc(100vw - 16px); max-height: calc(100dvh - 16px); overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; padding: 16px; border: 1px solid #718361; border-radius: 8px; background: #20291f; box-shadow: 0 12px 40px #0008; color: #dce8d2; user-select: text; }
  .node-description > strong { display: block; margin-top: 6px; font-size: 16px; }
  .node-description p { margin: 12px 0; font-size: 13px; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
  .node-description > code { display: block; color: #c5e7ae; font-size: 11px; overflow-wrap: anywhere; }
  .node-description > small { display: block; margin-top: 12px; padding-top: 10px; border-top: 1px solid #425238; color: #a4b49a; font-size: 10px; }
  .operation-head { display: flex; align-items: center; gap: 9px; padding: 12px; border-bottom: 1px solid #3a4433; } .operation-head small { display: block; font: 8px 'JetBrains Mono', monospace; text-transform: uppercase; letter-spacing: 1.4px; color: #9fad92; margin-bottom: 4px; } .operation-head strong { font-size: 13px; font-weight: 600; } .op-symbol { font: 21px 'JetBrains Mono', monospace; color: #c5e7ae; width: 27px; text-align: center; } .op-symbol.motion { color: #9caef4; } .op-symbol.delta { color: #efbc7b; }
  .status-dot { width: 5px; height: 5px; border-radius: 50%; background: #56604e; margin-left: auto; } .status-dot.done { background: #c5e7ae; } .status-dot.running { background: #efbc7b; animation: blink .6s infinite alternate; } .status-dot.cached { background: #9caef4; } @keyframes blink { to { opacity: .3; } }
  .sockets { padding: 7px 0; } .socket { position: relative; height: 25px; display: flex; align-items: center; gap: 5px; padding: 0 13px; font-size: 10px; } .socket code { margin-left: auto; color: #b5c4a7; font-size: 9px; } .socket.output { justify-content: flex-end; color: #c4d4b9; } .react-flow__handle { width: 12px; height: 12px; border: 0; border-radius: 50%; background: transparent; } .react-flow__handle-left { left: 0; } .react-flow__handle-right { right: 0; }
  .parameter-socket { height: auto; min-height: 38px; flex-wrap: wrap; padding-top: 5px; padding-bottom: 5px; border-top: 1px solid #394331; }
  .socket > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .socket-type { color: var(--socket-color); opacity: .78; font-size: 8px; white-space: nowrap; margin-left: auto; }
  .socket.output .socket-type { margin-left: 0; margin-right: auto; }
  .socket-control { width: 100%; display: flex; justify-content: flex-end; }
  .socket-control input:not([type=checkbox]), .socket-control select { width: 100%; min-width: 0; padding: 4px 6px; font-size: 11px; }
  .wired-parameter { color: #c5e7ae; font-size: 10px; padding: 3px 0; }
  .thumbnail-value { white-space: pre-wrap; overflow: auto; max-height: 100%; width: 100%; padding: 10px; font-size: 11px; color: #d2dfc6; }
  .value-preview { padding: 30px; width: 100%; height: 100%; overflow: auto; }
  .value-preview pre { margin-top: 15px; white-space: pre-wrap; font-size: 14px; line-height: 1.8; }
  .graph-flow-guide { padding: 7px 12px; border-bottom: 1px solid #34422c; color: #bfd3ad; background: #1b2418; font-size: 10px; flex-shrink: 0; }
  .graph-bottom { flex-wrap: wrap; gap: 7px; }
  .data-type-controls { margin-left: auto; display: flex; align-items: center; }
  .data-type-editor { position: fixed; z-index: 1001; top: 85px; left: 20px; width: min(520px, calc(100vw - 40px)); max-height: calc(100dvh - 110px); overflow: auto; padding: 16px; background: #20281d; border: 1px solid #687f54; border-radius: 10px; box-shadow: 0 10px 50px #0008; }
  .data-type-heading, .data-type-toolbar, .data-type-field { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
  .data-type-heading strong { flex: 1; }
  .data-type-editor p, .data-type-editor small { color: #b0bea2; font-size: 11px; line-height: 1.6; display: block; margin: 10px 0; }
  .data-type-editor label { display: flex; gap: 12px; align-items: center; font-size: 11px; margin: 12px 0; }
  .data-type-field input { flex: 1; min-width: 0; width: 40%; }
  .data-type-field select { width: 140px; }
  .data-type-fields { margin: 12px 0; }
  .menu-backdrop { position: fixed; inset: 0; z-index: 1000; cursor: default; }
  .node-menu.connection-menu { width: 340px; }
  .connection-menu .menu-title button { margin-left: auto; }
  .connection-list { overflow: auto; min-height: 0; overscroll-behavior: contain; scrollbar-width: thin; }
  .connection-item { padding: 12px 14px; border-bottom: 1px solid #3b4633; }
  .connection-item p { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; font-size: 12px; overflow-wrap: anywhere; }
  .connection-arrow { color: #99a393; font-size: 10px; }
  .connection-item button, .connection-all button { width: 100%; text-align: left; }
  .connection-all { padding: 10px 14px; flex-shrink: 0; }
  .connection-empty { padding: 14px; font-size: 12px; line-height: 1.6; color: #a1b494; }
  /* The hit area is larger than the dot, without shifting the wire's endpoint. */
  .react-flow__handle::before { content: ''; position: absolute; inset: -6px; border-radius: 50%; }
  .react-flow__handle::after { content: ''; position: absolute; inset: 0; border: 2px solid #1b2118; border-radius: 50%; background: var(--socket-color); pointer-events: none; transition: inset .1s, box-shadow .1s; }
  .react-flow__handle.connectable:hover, .react-flow__handle.connectionindicator { cursor: crosshair; }
  .react-flow__handle.connectable:hover::after, .react-flow__handle.connectingfrom::after, .react-flow__handle.connectingto::after { inset: -3px; border-color: #f1f6ed; box-shadow: 0 0 0 3px color-mix(in srgb, var(--socket-color) 50%, transparent), 0 0 12px var(--socket-color); }
  .socket:has(.react-flow__handle.connectable:hover), .socket:has(.react-flow__handle.connectingfrom), .socket:has(.react-flow__handle.connectingto) { color: #f1f6ed; background: color-mix(in srgb, var(--socket-color) 22%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--socket-color) 45%, transparent); }
  .socket:has(.react-flow__handle.connectingto.valid) { background: #416933; box-shadow: inset 0 0 0 1px #c5e7ae; }
  .react-flow__handle.connectingto.valid::after { background: #c5e7ae; }
  .socket:has(.react-flow__handle.connectingto:not(.valid)) { background: #673c32; box-shadow: inset 0 0 0 1px #ef9a81; }
  .react-flow__handle.connectingto:not(.valid)::after { background: #ef9a81; box-shadow: 0 0 0 3px #ef9a8155; }
  .node-menu { position: absolute; display: flex; flex-direction: column; max-height: calc(100dvh - 16px); width: 480px; max-width: calc(100vw - 16px); background: #20261e; border: 1px solid #607153; border-radius: 8px; box-shadow: 0 18px 60px #0009; overflow: hidden; color: #dce8d2; }
  .menu-title { display: flex; gap: 12px; align-items: center; padding: 10px 14px; border-bottom: 1px solid #3b4633; font-size: 12px; font-weight: 600; } .menu-title code { margin-left: auto; color: #8ea17f; font-weight: 400; } .menu-title button { border: 0; padding: 0 3px; background: transparent; }
  .menu-search { display: flex; align-items: center; margin: 11px; border: 1px solid #718361; border-radius: 5px; padding: 0 10px; background: #121b0f; gap: 8px; } .menu-search span { font-size: 23px; color: #a9cb8f; } .menu-search input { background: transparent; color: #ddeed0; border: 0; outline: 0; padding: 10px 0; width: 100%; font-size: 12px; } .menu-search input:focus-visible { outline: 0; }
  .menu-context { display: flex; flex-wrap: wrap; gap: 5px; margin: 0 11px 10px; } .menu-context button { font-size: 10px; padding: 5px 8px; }
  .menu-body { flex-shrink: 1; min-height: 0; display: grid; grid-template-columns: 125px 1fr; height: 307px; border-block: 1px solid #3b4633; } .menu-body.searching { grid-template-columns: 1fr; } .menu-body nav { padding: 6px; background: #181f15; border-right: 1px solid #3b4633; overflow: auto; } .menu-body nav button { display: flex; align-items: center; justify-content: space-between; width: 100%; border-color: transparent; padding: 6px 8px; border-radius: 3px; background: transparent; font-size: 11px; text-align: left; } .menu-body nav button.active { background: #35432c; color: #ccebb7; }
  .menu-results { overflow: auto; padding: 5px; } .menu-results > button { display: block; text-align: left; width: 100%; border-color: transparent; background: transparent; padding: 9px 10px; border-radius: 4px; } .menu-results button.highlighted { background: #35452c; border-color: #5f7850; } .menu-results strong { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; font-weight: 550; } .menu-results small { color: #aac098; font-size: 8px; font-family: 'JetBrains Mono', monospace; font-weight: 400; } .menu-results button > span { display: block; color: #a1b494; font-size: 10px; line-height: 1.5; margin-top: 5px; } .menu-results > p { padding: 20px 12px; font-size: 12px; line-height: 1.7; color: #acb9a2; }
  .menu-hint { padding: 9px 12px; font-size: 9px; color: #a6b899; display: flex; justify-content: space-between; } .menu-hint span { color: #c2d9af; }
  .editor-tabbar { display: flex; gap: 2px; background: #12190f; border-block: 1px solid #3b4633; min-height: 34px; flex-shrink: 0; overflow-x: auto; } .editor-tab { display: flex; flex-shrink: 0; align-items: center; border-right: 1px solid #333f2c; border-bottom: 2px solid transparent; } .editor-tab.active { background: #273320; border-bottom-color: #b5d49c; } .editor-tab button { background: transparent; border: 0; border-radius: 0; font-size: 10px; padding: 9px 12px; white-space: nowrap; } .editor-tab button + button { padding-inline: 7px; color: #8ea57c; } .editor-tab code { font-size: 8px; color: #9cb38a; } .history-buttons { margin-left: auto; display: flex; align-items: center; gap: 3px; padding: 3px 7px; } .history-buttons button { padding: 2px 7px; font-size: 17px; background: transparent; border: 0; }
  .enter-group { margin: 0 10px 8px; width: calc(100% - 20px); font-size: 10px; background: #323c47; border-color: #5a6c81; color: #c2d1e6; padding: 6px; }
  .interface-editor { flex-shrink: 0; background: #20281b; border-bottom: 1px solid #46533a; max-height: min(225px, 30%); overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; } .interface-editor summary { position: sticky; top: 0; z-index: 1; background: #20281b; padding: 10px 15px; color: #c5deb3; cursor: pointer; font-size: 11px; } .interface-editor summary span { font-size: 9px; color: #94a984; margin-left: 12px; } .interface-content { display: flex; gap: 15px; padding: 4px 15px 14px; flex-wrap: wrap; } .definition-name { display: flex; flex-direction: column; gap: 6px; color: #9aac8d; font-size: 10px; width: 155px; } .interface-content input:not([type=number]) { background: #121a0e; border: 1px solid #43553a; border-radius: 4px; color: #ddebd3; padding: 5px 7px; font-size: 11px; min-width: 0; } .interface-ports { flex: 1; min-width: 225px; } .interface-port-heading { display: flex; justify-content: space-between; align-items: center; font-size: 10px; color: #a9bd99; margin-bottom: 7px; } .interface-port-heading button { font-size: 9px; padding: 3px 6px; } .interface-port { display: flex; gap: 4px; margin-top: 5px; } .interface-port input:not([type=number]) { flex: 1; width: 90px; } .interface-port select { font-size: 9px; padding: 3px 4px; max-width: 72px; } .interface-port input[type=number] { width: 51px; padding: 3px; font-size: 9px; } .interface-port > button { padding: 2px 5px; font-size: 10px; }
  .prefab-controls { display: flex; align-items: end; gap: 7px; } .prefab-controls > div { display: flex; gap: 4px; } .prefab-controls button { padding: 7px 9px; }
  .node-preview-toolbar { padding: 5px 9px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #3a4433; border-radius: 8px 8px 0 0; background: #192016; font: 7px 'JetBrains Mono', monospace; letter-spacing: 1px; color: #8fa77b; } .node-preview-toolbar button { font-size: 8px; padding: 2px 5px; border-color: transparent; background: transparent; letter-spacing: 0; color: #bbd6a7; }
  .node-thumbnail { height: 130px; background: #0a1007; position: relative; display: flex; align-items: center; justify-content: center; overflow: hidden; border-bottom: 1px solid #3a4433; }
  .node-thumbnail canvas { width: 100%; height: 100%; object-fit: contain; pointer-events: none; } .node-thumbnail > span { color: #8c9e7e; font-size: 10px; line-height: 1.6; text-align: center; padding: 14px; } .node-thumbnail strong { font: 25px 'JetBrains Mono', monospace; color: #efbc7b; } .node-thumbnail .thumbnail-error { color: #dfb690; } .thumbnail-frame { position: absolute; bottom: 5px; left: 5px; color: #d6e9c8; background: #0e180bcc; padding: 3px 5px; font-size: 8px; }
  .graph-bottom button { font-size: 10px; padding: 3px 6px; }
  .parameters { border-top: 1px solid #3a4433; padding: 9px 12px; display: flex; flex-direction: column; gap: 7px; } .parameters label { display: flex; align-items: center; justify-content: space-between; gap: 5px; font-size: 10px; color: #b3c0a8; } .parameters input[type=number] { width: 63px; font-size: 10px; padding: 4px; } .parameters select { font-size: 10px; padding: 4px; max-width: 90px; } .op-foot { padding: 8px 10px; border-top: 1px solid #3a4433; display: flex; justify-content: space-between; align-items: center; background: #1b2218; border-radius: 0 0 8px 8px; gap: 4px; } .op-foot code { font-size: 8px; color: #91a282; overflow: hidden; text-overflow: ellipsis; } .op-foot span { font: 8px 'JetBrains Mono', monospace; color: #bbcfae; white-space: nowrap; }
  .splitter { cursor: col-resize; background: #20271d; border-left: 1px solid #394232; border-right: 1px solid #394232; touch-action: none; } .splitter:hover { background: #718362; }
  .inspect-panel { background: #1b2119; min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; } .inspect-panel .panel-heading { flex-shrink: 0; } .step-strip { display: flex; padding: 6px 12px; gap: 5px; overflow: auto; scrollbar-width: thin; flex-shrink: 0; } .step-strip button { white-space: nowrap; font-size: 10px; padding: 7px 9px; } .step-strip button span { color: #8a9e7b; margin-right: 6px; font-family: 'JetBrains Mono', monospace; }
  .preview-tools { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 16px; border-block: 1px solid #303b2a; font-size: 10px; } .preview-tools > div { display: flex; align-items: center; gap: 8px; } .preview-tools button { padding: 4px 7px; font-size: 10px; background: #1d2619; }
  .image-viewport { position: relative; overflow: hidden; min-height: 0; flex: 1; background-color: #0e120d; background-image: linear-gradient(45deg, #ffffff03 25%, transparent 25%), linear-gradient(-45deg, #ffffff03 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ffffff03 75%), linear-gradient(-45deg, transparent 75%, #ffffff03 75%); background-size: 20px 20px; background-position: 0 0, 0 10px, 10px -10px, -10px 0; cursor: crosshair; touch-action: none; }
  .image-viewport canvas { position: absolute; transform: translate(-50%, -50%); pointer-events: none; } .image-viewport:active { cursor: grabbing; }
  .empty-preview, .scalar-preview { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; flex-direction: column; text-align: center; gap: 16px; pointer-events: none; } .empty-preview p { color: #99a98e; font-size: 12px; line-height: 1.8; } .empty-icon { font-size: 33px; color: #99b187; border: 1px solid #3a4831; border-radius: 50%; width: 65px; height: 65px; display: grid; place-items: center; } .scalar-preview strong { font: 48px 'JetBrains Mono', monospace; color: #efbc7b; } .scalar-preview > span:last-child { font-size: 11px; color: #a8b69d; }
  .preview-badge { position: absolute; top: 12px; right: 12px; border: 1px solid #667454; background: #192313e8; border-radius: 4px; padding: 7px 10px; font-size: 11px; color: #c5e7ae; }
  .motion-key { position: absolute; bottom: 12px; left: 12px; padding: 9px 12px; border-radius: 5px; background: #152010ee; border: 1px solid #536846; display: flex; flex-direction: column; gap: 5px; font-size: 10px; pointer-events: none; } .motion-key strong { font: 11px 'JetBrains Mono', monospace; color: #c5e7ae; }
  .pixel-bar { flex-shrink: 0; flex-wrap: wrap; display: flex; align-items: center; gap: 9px; min-height: 36px; padding: 5px 16px; background: #141b11; border-block: 1px solid #303b2a; font-size: 10px; } .pixel-bar button { margin-left: auto; padding: 3px 7px; font-size: 10px; } .pixel-bar code { font-size: 10px; } .swatch { width: 12px; height: 12px; border: 1px solid #909f87; border-radius: 2px; }
  .view-options { flex-shrink: 0; padding: 6px 16px; display: flex; gap: 12px; align-items: center; font-size: 10px; color: #9bab90; } .view-options label { display: flex; gap: 8px; align-items: center; white-space: nowrap; } .view-options select { font-size: 10px; padding: 3px 6px; } .view-options > code { margin-left: auto; }
  .node-explanation { padding: 10px 16px 14px; background: #20271c; } .explanation-title { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 10px; } .explanation-title code { color: #bfd7a9; font-size: 10px; } .node-explanation p { font-size: 11px; line-height: 1.75; } .node-explanation p + p { margin-top: 7px; } .input-demands { display: flex; gap: 7px; align-items: center; margin-top: 12px; flex-wrap: wrap; } .input-demands .eyebrow { margin-right: 6px; } .input-demands button { font: 10px 'JetBrains Mono', monospace; padding: 3px 7px; } .input-demands .muted { font-size: 10px; }
  .timeline { min-height: 62px; padding: 8px 16px; display: flex; gap: 10px; align-items: center; background: #191f17; border-bottom: 1px solid #394232; } .time-heading { display: flex; align-items: center; gap: 8px; margin-right: 12px; } .time-heading code { font-size: 19px; color: #c5e7ae; } .time-heading .muted { font-size: 10px; } .timeline button { padding: 6px 10px; } .frame-number { width: 62px; } .timeline-track { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 10px; margin: 0 12px; } .timeline-track input { width: 100%; margin: 8px 0 0; } .timeline-track > div { display: flex; justify-content: space-between; font: 9px 'JetBrains Mono', monospace; color: #92a086; } .subframe { width: 175px; font-size: 10px; color: #a7b69a; display: flex; flex-wrap: wrap; gap: 9px; } .subframe code { margin-left: auto; color: #c5e7ae; } .subframe input { width: 100%; }
  .timeline-track { gap: 4px; }
  .timeline .timeline-slider { appearance: none; height: 20px; margin: 0; padding: 0; border: 0; background: transparent; touch-action: none; user-select: none; cursor: ew-resize; }
  .timeline-slider::-webkit-slider-runnable-track { height: 5px; border-radius: 3px; background: #46563c; }
  .timeline-slider::-webkit-slider-thumb { appearance: none; width: 14px; height: 14px; margin-top: -4.5px; border: 1px solid #d9eccb; border-radius: 50%; background: #b5d49c; }
  .timeline-slider::-moz-range-track { height: 5px; border-radius: 3px; background: #46563c; }
  .timeline-slider::-moz-range-thumb { box-sizing: border-box; width: 14px; height: 14px; border: 1px solid #d9eccb; border-radius: 50%; background: #b5d49c; }
  .timeline .timeline-slider:active { cursor: grabbing; }
  .timeline .timeline-slider:disabled { cursor: default; }
  .render-section { display: flex; align-items: center; padding: 8px 16px; gap: 20px; border-bottom: 1px solid #394232; background: #151b12; }
  .render-settings { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 5px 16px; flex: 1; min-width: 0; position: relative; }
  .render-controls { display: flex; gap: 16px; } .render-controls label { display: flex; align-items: center; gap: 7px; font-size: 10px; color: #b6c3ac; } .render-controls input, .render-controls select { width: 90px; } .render-controls select { padding: 6px; }
  .render-note { grid-column: 1 / -1; grid-row: 2; color: #9ead93; font-size: 10px; } .render-action { display: flex; gap: 12px; align-items: center; } .render-action button { white-space: nowrap; } progress { position: absolute; bottom: -8px; width: 100%; height: 3px; margin: 0; accent-color: #b5d49c; }
  .render-preview { min-height: 0; flex: 1; background: #10160d; overflow: hidden; display: flex; flex-direction: column; } .render-preview video { width: 100%; min-height: 0; flex: 1; object-fit: contain; background: #080c06; } .render-empty { display: flex; flex: 1; justify-content: center; align-items: center; flex-direction: column; gap: 12px; color: #8fa77b; text-align: center; padding: 25px; } .render-empty > span { font-size: 34px; } .render-empty strong { font-size: 13px; font-weight: 500; color: #b0c2a2; } .render-empty p { font-size: 11px; line-height: 1.8; }
  .movie-caption { display: flex; flex-shrink: 0; flex-wrap: wrap; padding: 11px 15px; align-items: center; justify-content: space-between; gap: 15px; font-size: 11px; color: #bed2ae; } .movie-caption small { display: block; margin-top: 5px; color: #91a084; font-size: 9px; }
  footer { display: flex; gap: 20px; justify-content: space-between; align-items: center; min-height: 26px; padding: 5px 16px; font-size: 9px; color: #96a68a; } footer > span { display: flex; align-items: center; gap: 8px; }

  .source-file { margin: 0 12px 12px; padding: 12px; border: 1px dashed #64745e; border-radius: 7px; display: grid; gap: 7px; background: #20291f; }
  .source-file.drag-over { background: #384e31; border-color: #c1e49b; }
  .source-file strong { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .source-file span, .source-file small { font-size: 10px; color: #a6b89f; }
  .source-file button, .source-file select { font-size: 11px; width: 100%; min-width: 0; }
  .project-folder-strip { padding: 4px 16px; display: flex; align-items: center; gap: 16px; background: #1b241c; font-size: 12px; border-bottom: 1px solid #334032; }
  .project-folder-strip small { color: #9ca798; flex: 1; }

  /* Only bounded panels scroll. The application itself always occupies the viewport. */
  .workspace-notices { max-height: 18dvh; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; }
  .project-folder-strip { min-width: 0; flex-wrap: wrap; gap: 8px 16px; }
  .project-folder-strip strong, .project-folder-strip > span { overflow-wrap: anywhere; }
  .project-folder-strip button { padding-block: 3px; }
  .project-folder-strip select { max-width: 100%; }
  .workspace-switcher { display: none; }
  .inspector-switcher { display: flex; flex-shrink: 0; gap: 6px; padding: 0 12px 6px; border-bottom: 1px solid #303b2a; }
  .inspector-switcher button, .workspace-switcher button { border-color: transparent; background: transparent; padding: 5px 9px; font-size: 11px; }
  .inspector-switcher button[aria-pressed=true], .workspace-switcher button[aria-pressed=true] { background: #293526; border-color: #536b42; color: #c5e7ae; }
  .ready-dot { display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: #b5d49c; margin-left: 8px; vertical-align: middle; }
  .frame-panel { position: relative; display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }
  .node-details { flex-shrink: 0; background: #20271c; border-top: 1px solid #303b2a; }
  .node-details summary { padding: 9px 16px; background: #20271c; font-size: 11px; color: #bfd7a9; cursor: pointer; }
  .node-details[open] .node-explanation { position: absolute; z-index: 2; bottom: 34px; left: 0; right: 0; max-height: calc(100% - 40px); overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; border-top: 1px solid #536b42; box-shadow: 0 -8px 24px #0005; }
  .node-details summary code { float: right; font-size: 9px; color: #99a393; max-width: 55%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .panel-heading > div, .template-label, .panel-heading select { min-width: 0; }
  .panel-heading select { max-width: 100%; }
  .panel-heading h1, .panel-heading h2 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .prefab-controls { min-width: 0; }
  .prefab-controls > div { flex-shrink: 0; }
  .menu-title, .menu-search, .menu-context, .menu-hint { flex-shrink: 0; }
  .menu-body nav, .menu-results { overscroll-behavior: contain; scrollbar-width: thin; }
  .graph-panel, .inspect-panel { container-type: inline-size; }
  @container (max-width: 460px) {
    .graph-panel .panel-heading > div:first-child { display: none; }
    .prefab-controls { width: 100%; }
    .template-label { flex: 1; }
    .preview-tools .muted, .view-options > span, .interface-editor summary span { display: none; }
    .graph-bottom { gap: 7px; }
    .graph-bottom .muted { display: none; }
    .scalar-preview strong { font-size: clamp(24px, 10cqi, 48px); }
  }
  @media (max-width: 1400px) {
    .brand .eyebrow, .brand-divider { display: none; }
    .panel-heading { padding: 8px 12px; }
    .panel-heading h1, .panel-heading h2 { font-size: 18px; }
    .render-controls { gap: 12px; }
    .render-controls label { flex-direction: column; align-items: start; gap: 3px; }
    .render-controls input, .render-controls select { width: 85px; }
    .preview-tools .muted, .view-options > span { display: none; }
    .clip-info { flex-direction: column; align-items: start; gap: 3px; }
    .clip-info strong { max-width: 100%; }
    .clip-info span { font-size: 10px; }
  }
  @media (max-width: 1100px) {
    .engine-state { display: none; }
    .graph-panel .panel-heading h1 { display: none; }
    .graph-panel .panel-heading { flex-wrap: wrap; gap: 5px; }
    .time-heading .eyebrow, .time-heading .muted { display: none; }
    .time-heading { margin-right: 0; }
    .render-section { gap: 12px; }
    .project-folder-strip small { display: none; }
    .graph-bottom { gap: 7px; }
    .graph-bottom .muted { display: none; }
  }
  @media (max-width: 900px) {
    .workspace-switcher { display: flex; gap: 6px; padding: 4px 12px; border-bottom: 1px solid #394232; }
    .workspace { display: flex; }
    .workspace > section { width: 100%; }
    .workspace[data-pane=graph] .inspect-panel, .workspace[data-pane=preview] .graph-panel, .splitter { display: none; }
    .graph-panel .panel-heading h1 { display: block; }
    .graph-panel .panel-heading { flex-wrap: nowrap; }
    .render-section > .eyebrow { display: none; }
    .render-action { gap: 6px; }
    .render-action code { font-size: 9px; }
    .clip-info span { display: none; }
    .pixel-bar .muted { font-size: 9px; }
    .project-folder-strip { font-size: 10px; }
    footer > span:last-child { display: none; }
  }
  @media (max-width: 600px) {
    .app-header { padding: 7px 10px; gap: 8px; align-items: start; }
    .brand { gap: 6px; }
    .brand-mark { display: none; }
    .brand strong { font-size: 20px; }
    .header-actions { justify-content: end; flex-wrap: wrap; gap: 5px; }
    .header-actions button { padding: 5px 7px; font-size: 10px; }
    .source-strip { padding: 6px 10px; gap: 6px; flex-wrap: wrap; }
    .clip-controls { flex: 1; }
    .clip-controls select { min-width: 0; flex: 1; width: 120px; font-size: 11px; }
    .clip-controls button { padding: 6px 8px; font-size: 11px; }
    .clip-info { order: 3; flex-basis: 100%; font-size: 10px; }
    .source-strip > button { font-size: 10px; padding: 5px; }
    .graph-panel .panel-heading > div:first-child { display: none; }
    .prefab-controls { width: 100%; }
    .template-label { flex: 1; }
    .interface-editor summary span { display: none; }
    .timeline { display: grid; grid-template-columns: auto auto 62px auto minmax(0, 1fr); gap: 7px; padding: 7px 10px; }
    .time-heading code { font-size: 13px; }
    .timeline-track { grid-column: 1 / 5; grid-row: 2; margin: 0; gap: 6px; }
    .subframe { width: auto; grid-column: 5; grid-row: 1 / 3; margin-left: 6px; gap: 7px; }
    .render-section { padding: 7px 10px; }
    .render-settings { grid-template-columns: minmax(0, 1fr); gap: 7px; }
    .render-controls { justify-content: space-between; gap: 6px; }
    .render-controls input, .render-controls select { width: 74px; }
    .render-action { grid-row: 2; justify-content: space-between; }
    .render-note { grid-row: 3; font-size: 9px; }
    .render-action button { font-size: 11px; padding: 5px 7px; }
    .graph-help { font-size: 9px; }
    .pixel-bar { gap: 5px; padding-inline: 10px; }
    .pixel-bar code { font-size: 9px; }
    .view-options { padding-inline: 10px; }
    .empty-preview { gap: 8px; padding: 10px; }
    .empty-icon { display: none; }
    .empty-preview h2 { font-size: 17px; }
    .empty-preview p, .empty-preview .eyebrow { font-size: 9px; }
    .render-empty { padding: 10px; gap: 8px; }
    .render-empty > span { display: none; }
    .error-banner { padding: 8px 10px; gap: 8px; flex-wrap: wrap; }
    .error-banner strong { font-size: 10px; }
    .movie-caption { padding: 8px 10px; font-size: 10px; gap: 8px; }
  }
  @media (max-height: 700px) and (min-width: 901px) {
    .panel-heading { min-height: 51px; padding-block: 6px; }
    .panel-heading .eyebrow { display: none; }
    .panel-heading h1, .panel-heading h2 { margin-top: 0; }
    .timeline { min-height: 52px; padding-block: 5px; }
    .subframe { row-gap: 6px; }
    .empty-preview { gap: 6px; }
    .empty-icon { display: none; }
    .empty-preview h2 { font-size: 17px; }
    .empty-preview p { font-size: 10px; }
    .empty-preview .eyebrow { display: none; }
  }
`
