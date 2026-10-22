const namedCodes = {
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  NumpadEnter: "Enter",
  NumpadMultiply: "Multiply",
  NumpadAdd: "Add",
  NumpadSubtract: "Subtract",
  NumpadDecimal: "Decimal",
  NumpadDivide: "Divide",
  Semicolon: "Oem1",
  Equal: "OemPlus",
  Comma: "OemComma",
  Minus: "OemMinus",
  Period: "OemPeriod",
  Slash: "Oem2",
  Backquote: "Oem3",
  BracketLeft: "Oem4",
  Backslash: "Oem5",
  BracketRight: "Oem6",
  Quote: "Oem7",
  IntlBackslash: "Oem102",
};

export function keyFromEvent(event, keys) {
  if (
    event.repeat ||
    event.isComposing ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    event.shiftKey
  )
    return null;
  // Electron on Windows exposes the layout-resolved VK value here. In particular,
  // punctuation must not be guessed from a US physical-key position.
  const nativeKey = keys.find((key) => key.virtual_key === event.keyCode);
  if (nativeKey) return nativeKey.name;
  let name = namedCodes[event.code] || event.code;
  // Windows polling binds virtual keys, so letters follow the active layout.
  if (/^[a-z]$/i.test(event.key)) name = event.key.toUpperCase();
  else if (/^Digit[0-9]$/.test(event.code)) name = `D${event.code.slice(-1)}`;
  else if (/^Numpad[0-9]$/.test(event.code))
    name = `NumPad${event.code.slice(-1)}`;
  return (
    keys.find((key) => key.name.toUpperCase() === name.toUpperCase())?.name ||
    null
  );
}

export function keyLabel(name, keys) {
  const wheel = /^WHEEL:([0-9A-F]{32}):([1-9][0-9]{0,2})$/i.exec(name);
  if (wheel) return `Wheel ${wheel[1].slice(0, 4)} · Button ${wheel[2]}`;
  return keys.find((key) => key.name === name)?.label || name;
}
