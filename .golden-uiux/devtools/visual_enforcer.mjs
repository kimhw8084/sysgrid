#!/usr/bin/env node
/* Golden's model-independent rendered UI constraint runner.
 * Requires an explicitly selected local Playwright runtime and Chromium.
 * It checks only declared hard constraints; it does not score aesthetics.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const VERSION = 'golden.visual-enforcement.v1';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SHA = /^[a-f0-9]{64}$/;
const args = process.argv.slice(2);
function arg(name, fallback) { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; }
function flag(name) { return args.includes(name); }
function hash(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function fileHash(file) { return hash(fs.readFileSync(file)); }
function fail(status, message) { const e = new Error(message); e.status = status; throw e; }
function safeName(value) { return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value); }
function isLoopback(host) { return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'; }
function resolveFrom(base, value) { return path.isAbsolute(value) ? path.resolve(value) : path.resolve(base, value); }
const BLOCKING_VIOLATIONS = new Set(['EXTERNAL_REQUEST_BLOCKED','MUTATING_REQUEST_BLOCKED','WEBSOCKET_ATTEMPT_BLOCKED','POPUP_BLOCKED','MANDATORY_VISUAL_CHECK_NOT_CONFIGURED']);
export function classifyRouteStatus(findings) {
  if (findings.some(x => BLOCKING_VIOLATIONS.has(x.code))) return 'BLOCKED';
  if (findings.some(x => x.severity === 'error')) return 'FAIL';
  if (findings.some(x => x.severity === 'unknown')) return 'UNKNOWN';
  return 'PASS';
}
export function shouldActivateFocusTarget(value) {
  return value?.expected_match === true && value?.focus_visible === true &&
    value?.indicator_visible === true && value?.indicator_clipped !== true &&
    value?.viewport_clipped !== true;
}
export function focusObservationFindings(value, expected) {
  const findings = [];
  if (!value?.expected_match || !value?.focus_visible || !value?.indicator_visible || value?.indicator_clipped || value?.viewport_clipped) {
    findings.push({code:'KEYBOARD_FOCUS_NOT_VISIBLE_OR_NOT_REACHED',severity:'error',expected,value});
  }
  if (value?.tab_stop && !String(value?.accessible_name || '').trim()) {
    findings.push({code:'FOCUSED_CONTROL_HAS_NO_ACCESSIBLE_NAME',severity:'error',expected,value});
  }
  return findings;
}

export const VISUAL_CHECK_NAMES = Object.freeze([
  'collisions', 'clipping', 'controls', 'scrolling', 'page_overflow',
  'contrast', 'geometry', 'images', 'icons', 'focus', 'focus_restoration', 'temporal',
  'positioned_surfaces', 'design_tokens'
]);

const STATE_ARRAYS = Object.freeze([
  'analysis_scope', 'required_controls', 'geometry_constraints', 'positioned_surfaces',
  'contrast', 'design_tokens', 'icon_constraints', 'scroll_containment',
  'focus_sequence', 'focus_restoration'
]);

function canonicalJson(value) {
  const normalize = input => Array.isArray(input) ? input.map(normalize) :
    input && typeof input === 'object' ? Object.fromEntries(Object.keys(input).sort().map(key => [key, normalize(input[key])])) : input;
  return JSON.stringify(normalize(value));
}

function mergeUniqueRecords(...values) {
  const result = [], seen = new Set();
  for (const value of values) {
    if (value === undefined) continue;
    if (!Array.isArray(value)) throw new Error('profile state policy arrays must remain arrays');
    for (const item of value) {
      const key = canonicalJson(item);
      if (!seen.has(key)) { seen.add(key); result.push(item); }
    }
  }
  return result;
}

function mergeTemporal(...configs) {
  const active = configs.filter(Boolean);
  if (!active.length) return null;
  const triggers = mergeUniqueRecords(active.map(x => x.trigger_action).filter(Boolean));
  const preparations = mergeUniqueRecords(active.map(x => x.trigger_prepare).filter(Boolean));
  if (triggers.length > 1) throw new Error('conflicting profile/request temporal trigger actions are BLOCKED');
  if (preparations.length > 1) throw new Error('conflicting profile/request temporal preparation actions are BLOCKED');
  const watches = new Map();
  for (const item of active.flatMap(x => x.watch || [])) {
    const selector = typeof item === 'string' ? item : item.selector;
    const prior = watches.get(selector);
    const limits = [prior?.max_movement_css_px, typeof item === 'string' ? null : item.max_movement_css_px].filter(Number.isFinite);
    watches.set(selector, {
      ...(typeof item === 'string' ? {} : item), selector,
      ...(limits.length ? { max_movement_css_px: Math.min(...limits) } : {}),
      ...(prior?.reason && item?.reason && prior.reason !== item.reason ? { reason: `${prior.reason}; ${item.reason}` } : {})
    });
  }
  const durations = active.map(x => Number(x.duration_ms)).filter(Number.isFinite);
  const intervals = active.map(x => Number(x.sample_interval_ms ?? 50)).filter(Number.isFinite);
  const movement = active.map(x => Number(x.max_movement_css_px)).filter(Number.isFinite);
  return {
    duration_ms: Math.max(...durations),
    sample_interval_ms: Math.min(...intervals),
    watch: [...watches.values()],
    forbid_transient: mergeUniqueRecords(active.flatMap(x => x.forbid_transient || [])),
    capture_route_actions: active.some(x => x.capture_route_actions === true),
    ...(movement.length ? { max_movement_css_px: Math.min(...movement) } : {}),
    ...(triggers.length ? { trigger_action: triggers[0] } : {}),
    ...(preparations.length ? { trigger_prepare: preparations[0] } : {})
  };
}

/**
 * Resolve a route's source-bound profile state additively. Request routes may
 * add observations, but cannot replace or relax profile constraints.
 */
export function resolveStatePolicy(policy, route) {
  const state = route.state_contract ? policy.states?.[route.state_contract] : null;
  if (route.state_contract && !state) throw new Error(`route references an undeclared project-profile state: ${route.state_contract}`);
  const merged = Object.fromEntries(STATE_ARRAYS.map(key => [key, mergeUniqueRecords(policy[key], state?.[key])]));
  merged.analysis_scope = mergeUniqueRecords(policy.scope_selectors, state?.analysis_scope);
  merged.required_controls = mergeUniqueRecords(policy.required_controls, state?.required_controls, route.required_controls);
  merged.scroll_containment = mergeUniqueRecords(policy.scroll_containment, state?.scroll_containment, route.scroll_containment);
  merged.focus_sequence = mergeUniqueRecords(policy.focus_sequence, state?.focus_sequence, route.focus_sequence);
  merged.focus_restoration = mergeUniqueRecords(policy.focus_restoration, state?.focus_restoration, route.focus_restoration);
  merged.temporal = mergeTemporal(policy.temporal, state?.temporal, route.temporal);
  merged.mandatory_checks = mergeUniqueRecords(policy.mandatory_checks, state?.mandatory_checks);
  merged.forbid_page_horizontal_overflow = policy.forbid_page_horizontal_overflow === true;
  return merged;
}

export function validateVisualPolicy(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) fail('BLOCKED', 'source-bound project profile must declare visual_enforcement');
  const checkNames = new Set(VISUAL_CHECK_NAMES);
  for (const key of [...STATE_ARRAYS.filter(key => key !== 'analysis_scope'), 'scope_selectors', 'mandatory_checks']) {
    if (policy[key] !== undefined && !Array.isArray(policy[key])) fail('BLOCKED', `visual_enforcement.${key} must be an array`);
  }
  for (const key of ['required_controls', 'scope_selectors']) for (const selector of policy[key] || []) if (typeof selector !== 'string' || !selector.trim()) fail('BLOCKED', `visual_enforcement.${key} selectors must be non-empty strings`);
  for (const key of ['geometry_constraints', 'positioned_surfaces', 'contrast', 'design_tokens', 'icon_constraints']) {
    for (const item of policy[key] || []) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) fail('BLOCKED', `visual_enforcement.${key} entries must be objects`);
      if (key === 'design_tokens') {
        if (typeof item.name !== 'string' || !item.name.trim()) fail('BLOCKED', 'visual_enforcement.design_tokens entries require a token name');
        if (item.selector !== undefined && (typeof item.selector !== 'string' || !item.selector.trim())) fail('BLOCKED', 'visual_enforcement.design_tokens selector must be a non-empty CSS selector');
        if (!item.values_by_theme || typeof item.values_by_theme !== 'object' || Array.isArray(item.values_by_theme)) fail('BLOCKED', 'visual_enforcement.design_tokens values_by_theme must be an object');
        if (item.required !== undefined && typeof item.required !== 'boolean') fail('BLOCKED', 'visual_enforcement.design_tokens required must be boolean');
      } else if (typeof item.selector !== 'string' || !item.selector.trim()) fail('BLOCKED', `visual_enforcement.${key} entries require a selector`);
    }
  }
  for (const key of policy.mandatory_checks || []) if (!checkNames.has(key)) fail('BLOCKED', `unsupported mandatory visual check: ${key}`);
  if (policy.states !== undefined && (!policy.states || typeof policy.states !== 'object' || Array.isArray(policy.states))) fail('BLOCKED', 'visual_enforcement.states must be an object');
  const states = [['<global>', policy], ...Object.entries(policy.states || {})];
  for (const [name, state] of states) {
    for (const step of state.focus_sequence || []) {
      if (!step || typeof step.selector !== 'string' || !step.selector.trim()) fail('BLOCKED', `${name}.focus_sequence entries require a selector`);
      if (step.start !== undefined && (typeof step.start !== 'string' || !step.start.trim())) fail('BLOCKED', `${name}.focus_sequence start must be a selector, $document, or $continue`);
    }
    if (name === '<global>') {
      for (const key of policy.mandatory_checks || []) if (!checkNames.has(key)) fail('BLOCKED', `unsupported mandatory visual check: ${key}`);
      if (state.temporal && (!Number.isInteger(state.temporal.duration_ms) || state.temporal.duration_ms < 1 || state.temporal.duration_ms > 10000)) fail('BLOCKED', 'visual_enforcement.temporal.duration_ms must be 1..10000');
      if (state.temporal) {
        const interval = state.temporal.sample_interval_ms ?? 50;
        if (!Number.isInteger(interval) || interval < 10 || interval > 1000) fail('BLOCKED', 'visual_enforcement.temporal.sample_interval_ms must be 10..1000');
        if ((state.temporal.watch || []).some(x => typeof x === 'string' ? !x : !x || typeof x.selector !== 'string' || !x.selector)) fail('BLOCKED', 'visual_enforcement.temporal.watch entries require selectors');
        if ((state.temporal.forbid_transient || []).some(x => typeof x !== 'string' || !x.trim())) fail('BLOCKED', 'visual_enforcement.temporal.forbid_transient entries must be selectors');
        if (state.temporal.capture_route_actions !== undefined && typeof state.temporal.capture_route_actions !== 'boolean') fail('BLOCKED', 'visual_enforcement.temporal.capture_route_actions must be boolean');
        if (state.temporal.trigger_prepare && (state.temporal.trigger_prepare.type !== 'click' || typeof state.temporal.trigger_prepare.selector !== 'string' || !state.temporal.trigger_prepare.selector.trim())) fail('BLOCKED', 'visual_enforcement.temporal.trigger_prepare must be a click with a selector');
      }
      continue;
    }
    if (!safeName(name) || !state || typeof state !== 'object' || Array.isArray(state)) fail('BLOCKED', `invalid source-bound visual state: ${name}`);
    const allowed = new Set([...STATE_ARRAYS, 'mandatory_checks', 'temporal']);
    for (const key of Object.keys(state)) if (!allowed.has(key)) fail('BLOCKED', `unsupported visual state policy field: ${name}.${key}`);
    for (const key of STATE_ARRAYS) if (state[key] !== undefined && !Array.isArray(state[key])) fail('BLOCKED', `${name}.${key} must be an array`);
    for (const key of ['analysis_scope', 'required_controls']) for (const selector of state[key] || []) if (typeof selector !== 'string' || !selector.trim()) fail('BLOCKED', `${name}.${key} selectors must be non-empty strings`);
    for (const key of ['geometry_constraints', 'positioned_surfaces', 'contrast', 'design_tokens', 'icon_constraints']) {
      for (const item of state[key] || []) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) fail('BLOCKED', `${name}.${key} entries must be objects`);
        if (key === 'design_tokens') {
          if (typeof item.name !== 'string' || !item.name.trim()) fail('BLOCKED', `${name}.design_tokens entries require a token name`);
          if (item.selector !== undefined && (typeof item.selector !== 'string' || !item.selector.trim())) fail('BLOCKED', `${name}.design_tokens selector must be a non-empty CSS selector`);
          if (!item.values_by_theme || typeof item.values_by_theme !== 'object' || Array.isArray(item.values_by_theme)) fail('BLOCKED', `${name}.design_tokens values_by_theme must be an object`);
          if (item.required !== undefined && typeof item.required !== 'boolean') fail('BLOCKED', `${name}.design_tokens required must be boolean`);
        } else if (typeof item.selector !== 'string' || !item.selector.trim()) fail('BLOCKED', `${name}.${key} entries require a selector`);
      }
    }
    for (const check of state.scroll_containment || []) {
      if (!check || typeof check.container !== 'string' || !check.container.trim() || typeof check.target !== 'string' || !check.target.trim()) fail('BLOCKED', `${name}.scroll_containment entries require container and target selectors`);
      if (check.axis !== undefined && !['x', 'y'].includes(check.axis)) fail('BLOCKED', `${name}.scroll_containment axis must be x or y`);
      if (check.max_steps !== undefined && (!Number.isInteger(check.max_steps) || check.max_steps < 1 || check.max_steps > 20)) fail('BLOCKED', `${name}.scroll_containment max_steps must be 1..20`);
      if (check.wheel_delta !== undefined && (!Number.isFinite(check.wheel_delta) || Math.abs(check.wheel_delta) < 1 || Math.abs(check.wheel_delta) > 1000)) fail('BLOCKED', `${name}.scroll_containment wheel_delta must be 1..1000`);
      if (check.minimum_scroll_delta !== undefined && (!Number.isFinite(check.minimum_scroll_delta) || check.minimum_scroll_delta < 0)) fail('BLOCKED', `${name}.scroll_containment minimum_scroll_delta must be non-negative`);
    }
    for (const step of state.focus_sequence || []) {
      if (!step || typeof step.selector !== 'string' || !step.selector.trim()) fail('BLOCKED', `${name}.focus_sequence entries require a selector`);
      if (step.start !== undefined && (typeof step.start !== 'string' || !step.start.trim())) fail('BLOCKED', `${name}.focus_sequence start must be a selector, $document, or $continue`);
    }
    for (const check of state.focus_restoration || []) {
      if (!check || typeof check.selector !== 'string' || !check.selector.trim()) fail('BLOCKED', `${name}.focus_restoration entries require a selector`);
        if (check.open_selector !== undefined && (typeof check.open_selector !== 'string' || !check.open_selector.trim())) fail('BLOCKED', `${name}.focus_restoration open_selector must be a selector`);
      if (check.open_key !== undefined && !['Enter','Space','ArrowDown'].includes(check.open_key)) fail('BLOCKED', `${name}.focus_restoration open_key must be Enter, Space, or ArrowDown`);
      if (check.dismiss_key !== undefined && check.dismiss_key !== 'Escape') fail('BLOCKED', `${name}.focus_restoration dismiss_key must be Escape`);
      if (check.settle_ms !== undefined && (!Number.isInteger(check.settle_ms) || check.settle_ms < 0 || check.settle_ms > 2000)) fail('BLOCKED', `${name}.focus_restoration settle_ms must be 0..2000`);
    }
    for (const key of state.mandatory_checks || []) if (!checkNames.has(key)) fail('BLOCKED', `unsupported mandatory visual check in ${name}: ${key}`);
    if (state.temporal && (!Number.isInteger(state.temporal.duration_ms) || state.temporal.duration_ms < 1 || state.temporal.duration_ms > 10000)) fail('BLOCKED', `${name}.temporal.duration_ms must be 1..10000`);
    if (state.temporal) {
      const interval = state.temporal.sample_interval_ms ?? 50;
      if (!Number.isInteger(interval) || interval < 10 || interval > 1000) fail('BLOCKED', `${name}.temporal.sample_interval_ms must be 10..1000`);
      if ((state.temporal.watch || []).some(x => typeof x === 'string' ? !x : !x || typeof x.selector !== 'string' || !x.selector)) fail('BLOCKED', `${name}.temporal.watch entries require selectors`);
      if ((state.temporal.forbid_transient || []).some(x => typeof x !== 'string' || !x.trim())) fail('BLOCKED', `${name}.temporal.forbid_transient entries must be selectors`);
      if (state.temporal.capture_route_actions !== undefined && typeof state.temporal.capture_route_actions !== 'boolean') fail('BLOCKED', `${name}.temporal.capture_route_actions must be boolean`);
      if (state.temporal.trigger_prepare && (state.temporal.trigger_prepare.type !== 'click' || typeof state.temporal.trigger_prepare.selector !== 'string' || !state.temporal.trigger_prepare.selector.trim())) fail('BLOCKED', `${name}.temporal.trigger_prepare must be a click with a selector`);
    }
  }
}

export function visualCheckCoverage(effective, checks, actions = [], focus = [], temporal = null) {
  const has = (list, result) => list.length > 0 && Array.isArray(result) && result.length > 0;
  const text = Number(checks?.text_fragment_count || 0);
  const scrollConfigured = effective.scroll_containment.length > 0;
  const scrollResults = actions.filter(x => x.type === 'scroll_containment');
  const scrollProbeResults = actions.filter(x => x.type === 'scroll_probe');
  const observedScrollAxes = Array.isArray(checks?.scrollable_content)
    ? checks.scrollable_content.reduce((total, item) => total + Number(item.axes?.x === true) + Number(item.axes?.y === true), 0)
    : null;
  const observedScrollExecuted = observedScrollAxes !== null && scrollProbeResults.length === observedScrollAxes;
  const requiredResults = checks?.required_controls;
  const requiredControlsAccounted = effective.required_controls.length > 0 && Array.isArray(requiredResults)
    && effective.required_controls.every(selector => requiredResults.some(result => result.selector === selector && ['PASS', 'FAIL', 'FAIL_MISSING', 'NOT_APPLICABLE_OUTSIDE_ANALYSIS_SCOPE'].includes(result.status)));
  const focusSequenceConfigured = effective.focus_sequence.length > 0;
  const focusSequenceResults = focus.filter(x => x.expected && x.kind !== 'restoration');
  const focusReturnConfigured = effective.focus_restoration.length > 0;
  const focusReturnResults = focus.filter(x => x.kind === 'restoration');
  return {
    collisions: checks ? (text ? 'EXECUTED' : 'NOT_APPLICABLE_NO_VISIBLE_TEXT') : 'NOT_RUN',
    clipping: checks ? (text ? 'EXECUTED' : 'NOT_APPLICABLE_NO_VISIBLE_TEXT') : 'NOT_RUN',
    controls: effective.required_controls.length ? (requiredControlsAccounted ? 'EXECUTED' : 'NOT_RUN') : 'NOT_CONFIGURED',
    scrolling: scrollConfigured
      ? (scrollResults.length === effective.scroll_containment.length && observedScrollExecuted ? 'EXECUTED' : 'NOT_RUN')
      : Array.isArray(checks?.scrollable_content)
        ? (observedScrollAxes === 0 ? 'NOT_APPLICABLE_NO_SCROLLABLE_CONTENT' : observedScrollExecuted ? 'EXECUTED' : 'NOT_RUN')
        : 'NOT_CONFIGURED',
    page_overflow: effective.forbid_page_horizontal_overflow === true && checks?.document ? 'EXECUTED' : 'NOT_CONFIGURED',
    contrast: has(effective.contrast, checks?.contrast) ? 'EXECUTED' : 'NOT_CONFIGURED',
    geometry: has(effective.geometry_constraints, checks?.geometry) ? 'EXECUTED' : 'NOT_CONFIGURED',
    images: Array.isArray(checks?.images) ? (checks.images.length ? 'EXECUTED' : 'NOT_APPLICABLE_NO_VISIBLE_IMAGES') : 'NOT_RUN',
    icons: has(effective.icon_constraints, checks?.icons) ? 'EXECUTED' : 'NOT_CONFIGURED',
    focus: focusSequenceConfigured ? (focusSequenceResults.length === effective.focus_sequence.length ? 'EXECUTED' : 'NOT_RUN') : 'NOT_CONFIGURED',
    focus_restoration: focusReturnConfigured ? (focusReturnResults.length === effective.focus_restoration.length ? 'EXECUTED' : 'NOT_RUN') : 'NOT_CONFIGURED',
    temporal: effective.temporal ? (temporal?.frames?.length ? 'EXECUTED' : 'NOT_RUN') : 'NOT_CONFIGURED',
    positioned_surfaces: has(effective.positioned_surfaces, checks?.surfaces) ? 'EXECUTED' : 'NOT_CONFIGURED',
    design_tokens: has(effective.design_tokens, checks?.tokens) ? 'EXECUTED' : 'NOT_CONFIGURED'
  };
}

/** Use real pointer-wheel input to verify each measured scroll axis and restore its exact starting position. */
export async function probeScrollableContent(page, inventory = []) {
  if (!Array.isArray(inventory)) throw new Error('scrollable content inventory must be an array');
  const results = [];
  for (const item of inventory) {
    for (const axis of ['x', 'y']) {
      if (item.axes?.[axis] !== true) continue;
      let prepared;
      try {
        prepared = await page.evaluate(({ selector, axis }) => {
          const documentTarget = selector === 'document.scrollingElement';
          const el = documentTarget ? document.scrollingElement : (() => { try { return document.querySelector(selector); } catch { return null; } })();
          if (!el) return { status: 'UNKNOWN_TARGET_MISSING', selector, axis };
          const dimension = axis === 'x' ? 'scrollWidth' : 'scrollHeight';
          const clientDimension = axis === 'x' ? 'clientWidth' : 'clientHeight';
          const position = axis === 'x' ? 'scrollLeft' : 'scrollTop';
          const maximum = Math.max(0, el[dimension] - el[clientDimension]);
          if (maximum <= 1) return { status: 'UNKNOWN_SCROLL_RANGE_CHANGED', selector, axis, maximum_css_px: maximum };
          const originalPosition = el[position];
          const selectorFor = node => {
            if (node === document.scrollingElement) return 'document.scrollingElement';
            const parts = [];
            for (let current = node; current && current instanceof Element; current = current.parentElement) {
              let part = current.tagName.toLowerCase();
              if (current.id) { part += `#${CSS.escape(current.id)}`; parts.unshift(part); break; }
              const siblings = current.parentElement ? [...current.parentElement.children].filter(sibling => sibling.tagName === current.tagName) : [];
              if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
              parts.unshift(part);
            }
            return parts.join(' > ');
          };
          const restoreChain = [];
          for (let current = el; current && current instanceof Element; current = current.parentElement) {
            const scrolls = current.scrollHeight > current.clientHeight + 1 || current.scrollWidth > current.clientWidth + 1;
            if (scrolls && !restoreChain.some(item => item.element === current)) restoreChain.push({
              element: current, selector: current === el ? selector : selectorFor(current), scrollLeft: current.scrollLeft, scrollTop: current.scrollTop,
              behavior: current.style.getPropertyValue('scroll-behavior'), priority: current.style.getPropertyPriority('scroll-behavior')
            });
          }
          if (document.scrollingElement && !restoreChain.some(item => item.element === document.scrollingElement)) restoreChain.push({
            element: document.scrollingElement, selector: 'document.scrollingElement', scrollLeft: document.scrollingElement.scrollLeft,
            scrollTop: document.scrollingElement.scrollTop, behavior: document.scrollingElement.style.getPropertyValue('scroll-behavior'),
            priority: document.scrollingElement.style.getPropertyPriority('scroll-behavior')
          });
          for (const saved of restoreChain) saved.element.style.setProperty('scroll-behavior', 'auto', 'important');
          try { if (!documentTarget) el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); } catch { /* hit testing below will keep the result UNKNOWN if positioning failed */ }
          for (const saved of restoreChain) saved.element.style.setProperty('scroll-behavior', 'auto', 'important');
          const restorePayload = restoreChain.map(({element, ...saved}) => saved);
          let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
          if (!documentTarget) {
            const rect = el.getBoundingClientRect();
            const sx = el.offsetWidth ? rect.width / el.offsetWidth : 1, sy = el.offsetHeight ? rect.height / el.offsetHeight : 1;
            left = rect.left + el.clientLeft * sx; top = rect.top + el.clientTop * sy;
            right = left + el.clientWidth * sx; bottom = top + el.clientHeight * sy;
            for (let parent = el.parentElement; parent && parent !== document.documentElement; parent = parent.parentElement) {
              const style = getComputedStyle(parent);
              const clipX = ['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX);
              const clipY = ['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY);
              if (!clipX && !clipY) continue;
              const box = parent.getBoundingClientRect();
              const psx = parent.offsetWidth ? box.width / parent.offsetWidth : 1, psy = parent.offsetHeight ? box.height / parent.offsetHeight : 1;
              const contentLeft = box.left + parent.clientLeft * psx, contentTop = box.top + parent.clientTop * psy;
              if (clipX) { left = Math.max(left, contentLeft); right = Math.min(right, contentLeft + parent.clientWidth * psx); }
              if (clipY) { top = Math.max(top, contentTop); bottom = Math.min(bottom, contentTop + parent.clientHeight * psy); }
            }
            left = Math.max(0, left); top = Math.max(0, top); right = Math.min(innerWidth, right); bottom = Math.min(innerHeight, bottom);
          }
          const candidates = [.15,.35,.5,.65,.85].flatMap(fx => [.15,.35,.5,.65,.85].map(fy => ({
            x: Math.round(left + Math.max(0,right-left) * fx), y: Math.round(top + Math.max(0,bottom-top) * fy)
          }))).filter(point => point.x >= 0 && point.x < innerWidth && point.y >= 0 && point.y < innerHeight);
          const point = candidates.find(candidate => {
            const hit = document.elementFromPoint(candidate.x, candidate.y);
            return documentTarget ? !!hit : !!hit && (hit === el || el.contains(hit));
          });
          if (!point) {
            for (const saved of restoreChain) { saved.element.scrollLeft = saved.scrollLeft; saved.element.scrollTop = saved.scrollTop; }
            for (const saved of restoreChain) { if (saved.behavior) saved.element.style.setProperty('scroll-behavior', saved.behavior, saved.priority); else saved.element.style.removeProperty('scroll-behavior'); }
            return { status: 'UNKNOWN_NO_HIT_TESTABLE_SCROLL_SURFACE', selector, axis, candidates, restored_ancestor_count: restoreChain.length };
          }
          el[position] = 0;
          return { status: 'READY', selector, axis, point, maximum_css_px: maximum, original_position_css_px: originalPosition,
            restore_chain: restorePayload, document_target: documentTarget };
        }, { selector: item.selector, axis });
      } catch (error) {
        results.push({ type: 'scroll_probe', selector: item.selector, axis, status: 'UNKNOWN_PREPARE_ERROR', error: String(error).slice(0, 240) });
        continue;
      }
      if (prepared.status !== 'READY') {
        results.push({ type: 'scroll_probe', ...prepared });
        continue;
      }
      let afterPosition = null, restoredPosition = null, movement = 0, wheelDelta = 120, wheelError = null;
      try {
        await page.mouse.move(prepared.point.x, prepared.point.y);
        await page.mouse.wheel(axis === 'x' ? wheelDelta : 0, axis === 'y' ? wheelDelta : 0);
        await page.waitForTimeout(80);
        afterPosition = await page.evaluate(({ selector, axis }) => {
          const el = selector === 'document.scrollingElement' ? document.scrollingElement : (() => { try { return document.querySelector(selector); } catch { return null; } })();
          return el ? (axis === 'x' ? el.scrollLeft : el.scrollTop) : null;
        }, { selector: item.selector, axis });
        movement = afterPosition === null ? 0 : Math.abs(afterPosition);
        if (movement <= 1 && axis === 'x') {
          wheelDelta = -120;
          await page.mouse.wheel(-120, 0);
          await page.waitForTimeout(80);
          afterPosition = await page.evaluate(({ selector, axis }) => {
            const el = selector === 'document.scrollingElement' ? document.scrollingElement : (() => { try { return document.querySelector(selector); } catch { return null; } })();
            return el ? (axis === 'x' ? el.scrollLeft : el.scrollTop) : null;
          }, { selector: item.selector, axis });
          movement = afterPosition === null ? 0 : Math.abs(afterPosition);
        }
      } catch (error) {
        wheelError = String(error).slice(0, 240);
      } finally {
        try {
          restoredPosition = await page.evaluate(({ restoreChain, selector, axis }) => {
            const records = restoreChain.map(saved => {
              const el = saved.selector === 'document.scrollingElement' ? document.scrollingElement : (() => { try { return document.querySelector(saved.selector); } catch { return null; } })();
              if (el) el.style.setProperty('scroll-behavior', 'auto', 'important');
              return { saved, el };
            });
            for (const { saved, el } of records) if (el) { el.scrollLeft = saved.scrollLeft; el.scrollTop = saved.scrollTop; }
            const restored = records.map(({ saved, el }) => {
              if (!el) return { selector: saved.selector, restored: false, scrollLeft: null, scrollTop: null };
              if (saved.behavior) el.style.setProperty('scroll-behavior', saved.behavior, saved.priority); else el.style.removeProperty('scroll-behavior');
              return { selector: saved.selector, restored: Math.abs(el.scrollLeft - saved.scrollLeft) <= 1 && Math.abs(el.scrollTop - saved.scrollTop) <= 1,
                scrollLeft: el.scrollLeft, scrollTop: el.scrollTop, expected_scroll_left: saved.scrollLeft, expected_scroll_top: saved.scrollTop };
            });
            const target = records.find(({ saved }) => saved.selector === selector);
            const targetPosition = target?.el ? (axis === 'x' ? target.el.scrollLeft : target.el.scrollTop) : null;
            return { targetPosition, all_restored: restored.length === restoreChain.length && restored.every(item => item.restored), ancestors: restored };
          }, { restoreChain: prepared.restore_chain, selector: item.selector, axis });
        } catch { restoredPosition = null; }
      }
      if (wheelError) {
        results.push({ type: 'scroll_probe', selector: item.selector, axis, status: 'UNKNOWN_WHEEL_ERROR', error: wheelError, point: prepared.point, restored_position_css_px: restoredPosition });
        continue;
      }
      const restored = restoredPosition !== null && restoredPosition.all_restored === true &&
        Math.abs(restoredPosition.targetPosition - prepared.original_position_css_px) <= 1;
      const status = movement > 1 && restored ? 'PASS' : !restored ? 'FAIL_RESTORE_SCROLL_POSITION' : 'FAIL_WHEEL_DID_NOT_SCROLL_CONTAINER';
      results.push({ type: 'scroll_probe', selector: item.selector, axis, status, point: prepared.point, maximum_css_px: prepared.maximum_css_px,
        wheel_delta_css_px: axis === 'x' ? { x: wheelDelta, y: 0 } : { x: 0, y: wheelDelta }, start_position_css_px: 0,
        after_wheel_position_css_px: afterPosition, movement_css_px: Number(movement.toFixed(2)),
        restored_position_css_px: restoredPosition?.targetPosition ?? null, restored_ancestor_positions: restoredPosition?.ancestors ?? null,
        original_position_css_px: prepared.original_position_css_px, restored });
    }
  }
  return results;
}

export async function waitForFocusPresentation(page, selector, minimumWaitMs=0, timeoutMs=1500) {
  if(typeof selector!=='string'||!selector||!Number.isInteger(minimumWaitMs)||minimumWaitMs<0||minimumWaitMs>2000||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>5000) throw new Error('invalid focus presentation wait bounds');
  return page.evaluate(async ({selector,minimumWaitMs,timeoutMs})=>{
    const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    await pause(minimumWaitMs);
    const started=performance.now();let previous=null,stableFrames=0,frames=0,last=null;
    while(performance.now()-started<=timeoutMs){
      await new Promise(resolve=>requestAnimationFrame(resolve));frames++;
      const el=document.querySelector(selector);
      if(!el)return{status:'FAIL_TARGET_ABSENT',selector,frames,elapsed_ms:performance.now()-started};
      const s=getComputedStyle(el),r=el.getBoundingClientRect(),round=n=>Math.round(n*100)/100;
      const running=el.getAnimations().filter(animation=>animation.playState==='running').map(animation=>animation.effect?.getComputedTiming()?.progress??null);
      last={rect:{x:round(r.x),y:round(r.y),width:round(r.width),height:round(r.height)},transform:s.transform,opacity:s.opacity,visibility:s.visibility,display:s.display,outline:{style:s.outlineStyle,width:s.outlineWidth,color:s.outlineColor},boxShadow:s.boxShadow,running_animation_count:running.length};
      const stableState={...last,running_animation_count:0};
      if(running.length===0&&previous===JSON.stringify(stableState))stableFrames++;else stableFrames=0;
      previous=JSON.stringify(stableState);
      if(stableFrames>=3)return{status:'PASS_PRESENTATION_SETTLED',selector,frames,elapsed_ms:round(performance.now()-started),sample:last};
    }
    return{status:'UNKNOWN_PRESENTATION_DID_NOT_SETTLE',selector,frames,elapsed_ms:Math.round((performance.now()-started)*100)/100,sample:last};
  },{selector,minimumWaitMs,timeoutMs});
}

export async function scrollIntoViewSettled(locator, alignment = {}) {
  const block = alignment.block || 'nearest';
  const inline = alignment.inline || 'nearest';
  if (!['start', 'center', 'end', 'nearest'].includes(block) || !['start', 'center', 'end', 'nearest'].includes(inline)) throw new Error('scroll alignment must be start, center, end, or nearest');
  return locator.evaluate(async (el, options) => {
    const scrollers = [];
    for (let p = el; p; p = p.parentElement) {
      const style = getComputedStyle(p);
      const scrollable = p.scrollWidth > p.clientWidth || p.scrollHeight > p.clientHeight;
      if (scrollable && ['auto', 'scroll', 'hidden'].some(value => style.overflowX === value || style.overflowY === value)) {
        scrollers.push({el:p, left:p.scrollLeft, top:p.scrollTop, behavior:p.style.getPropertyValue('scroll-behavior'), priority:p.style.getPropertyPriority('scroll-behavior')});
      }
    }
    const root = document.scrollingElement;
    if (root && !scrollers.some(item => item.el === root)) scrollers.push({el:root, left:root.scrollLeft, top:root.scrollTop, behavior:root.style.getPropertyValue('scroll-behavior'), priority:root.style.getPropertyPriority('scroll-behavior')});
    for (const item of scrollers) item.el.style.setProperty('scroll-behavior', 'auto', 'important');
    try {
      await new Promise(resolve => requestAnimationFrame(resolve));
      let prior = scrollers.map(item => [item.el.scrollLeft, item.el.scrollTop]), stableFrames = 0;
      for (let frame = 0; frame < 120; frame++) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        const current = scrollers.map(item => [item.el.scrollLeft, item.el.scrollTop]);
        if (current.every((value, index) => Math.abs(value[0]-prior[index][0]) < 0.1 && Math.abs(value[1]-prior[index][1]) < 0.1)) stableFrames++;
        else stableFrames = 0;
        if (stableFrames >= 3) break;
        prior = current;
      }
      if (stableFrames < 3) throw new Error('pre-existing scroll did not settle within 120 animation frames');
      el.scrollIntoView({block:options.block, inline:options.inline, behavior:'auto'});
      stableFrames = 0;
      prior = scrollers.map(item => [item.el.scrollLeft, item.el.scrollTop]);
      for (let frame = 0; frame < 120; frame++) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        const current = scrollers.map(item => [item.el.scrollLeft, item.el.scrollTop]);
        if (current.every((value, index) => Math.abs(value[0]-prior[index][0]) < 0.1 && Math.abs(value[1]-prior[index][1]) < 0.1)) stableFrames++;
        else stableFrames = 0;
        if (stableFrames >= 3) {
          const targetRect=el.getBoundingClientRect(), scrollRects=scrollers.map(item=>{const r=item.el.getBoundingClientRect();return{selector:item.el.id?'#'+CSS.escape(item.el.id):item.el.tagName.toLowerCase(),left:item.el.scrollLeft,top:item.el.scrollTop,rect:{x:r.x,y:r.y,right:r.right,bottom:r.bottom}};});
          return {status:'PASS_SCROLL_SETTLED',frames:frame+1,target_rect:{x:targetRect.x,y:targetRect.y,right:targetRect.right,bottom:targetRect.bottom},scroll_positions:scrollRects};
        }
        prior = current;
      }
      throw new Error('scroll position did not settle within 120 animation frames');
    } finally {
      for (const item of scrollers) {
        item.el.scrollTo({left:item.left, top:item.top, behavior:'instant'});
        if (item.behavior) item.el.style.setProperty('scroll-behavior', item.behavior, item.priority);
        else item.el.style.removeProperty('scroll-behavior');
      }
    }
  }, {block, inline});
}

export async function scrollContainerToTarget(page, check) {
  if (!check || typeof check.container !== 'string' || !check.container || typeof check.target !== 'string' || !check.target) throw new Error('scroll containment requires container and target selectors');
  const axis = check.axis || 'y';
  if (!['x', 'y'].includes(axis)) throw new Error('scroll containment axis must be x or y');
  const maxSteps = check.max_steps ?? 12;
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 20) throw new Error('scroll containment max_steps must be 1..20');
  const wheelDelta = Math.abs(Number(check.wheel_delta ?? 160));
  if (!Number.isFinite(wheelDelta) || wheelDelta < 1 || wheelDelta > 1000) throw new Error('scroll containment wheel_delta must be 1..1000');
  const minimumDelta = Number(check.minimum_scroll_delta ?? 0);
  if (!Number.isFinite(minimumDelta) || minimumDelta < 0) throw new Error('scroll containment minimum_scroll_delta must be non-negative');
  const container = page.locator(check.container).first();
  const target = page.locator(check.target).first();
  const bounds = await container.boundingBox({ timeout: 5000 });
  if (!bounds) throw new Error('scroll container is not rendered: ' + check.container);
  const hitPoint = await container.evaluate(el => {
    const r = el.getBoundingClientRect();
    const sx = el.offsetWidth ? r.width / el.offsetWidth : 1;
    const sy = el.offsetHeight ? r.height / el.offsetHeight : 1;
    let left = Math.max(0, r.left + el.clientLeft * sx);
    let top = Math.max(0, r.top + el.clientTop * sy);
    let right = Math.min(innerWidth, r.left + el.clientLeft * sx + el.clientWidth * sx);
    let bottom = Math.min(innerHeight, r.top + el.clientTop * sy + el.clientHeight * sy);
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      const clipsX = ['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX);
      const clipsY = ['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY);
      if (!clipsX && !clipsY) continue;
      const parentRect = parent.getBoundingClientRect();
      const parentScaleX = parent.offsetWidth ? parentRect.width / parent.offsetWidth : 1;
      const parentScaleY = parent.offsetHeight ? parentRect.height / parent.offsetHeight : 1;
      const clipLeft = parentRect.left + parent.clientLeft * parentScaleX;
      const clipTop = parentRect.top + parent.clientTop * parentScaleY;
      const clipRight = clipLeft + parent.clientWidth * parentScaleX;
      const clipBottom = clipTop + parent.clientHeight * parentScaleY;
      if (clipsX) {
        left = Math.max(left, clipLeft);
        right = Math.min(right, clipRight);
      }
      if (clipsY) {
        top = Math.max(top, clipTop);
        bottom = Math.min(bottom, clipBottom);
      }
    }
    const visibleRect = { left, top, right, bottom };
    if (right - left < 2 || bottom - top < 2) return { point: null, visible_rect: visibleRect };
    for (const fx of [0.5, 0.25, 0.75]) {
      for (const fy of [0.5, 0.25, 0.75]) {
        const point = { x: left + (right - left) * fx, y: top + (bottom - top) * fy };
        const hit = document.elementFromPoint(point.x, point.y);
        if (hit && (hit === el || el.contains(hit))) {
          return { point, visible_rect: visibleRect, hit: hit.id ? '#' + CSS.escape(hit.id) : hit.tagName.toLowerCase() };
        }
      }
    }
    return { point: null, visible_rect: visibleRect, hit_test_failed: true };
  });
  if (!hitPoint.point) return {
    target_present: await target.count() > 0,
    visible: false,
    initial_visible: false,
    scrollLeft: 0,
    scrollTop: 0,
    delta: 0,
    steps: [],
    container: hitPoint.visible_rect,
    wheel_point: hitPoint,
    status: 'FAIL_SCROLL_SURFACE_NOT_HIT_TESTABLE',
    restored: true,
  };
  const pause = Math.max(0, Math.min(1000, Number(check.settle_ms ?? 50)));
  const measure = () => container.evaluate((el, targetSelector) => {
    const target = document.querySelector(targetSelector);
    if (!target) return { target_present: false };
    const r = el.getBoundingClientRect(), t = target.getBoundingClientRect();
    const sx = el.offsetWidth ? r.width / el.offsetWidth : 1, sy = el.offsetHeight ? r.height / el.offsetHeight : 1;
    const left = r.x + el.clientLeft * sx, top = r.y + el.clientTop * sy;
    const right = left + el.clientWidth * sx, bottom = top + el.clientHeight * sy;
    const tolerance = 1;
    return {
      target_present: true,
      visible: t.left >= left - tolerance && t.right <= right + tolerance && t.top >= top - tolerance && t.bottom <= bottom + tolerance,
      scrollLeft: el.scrollLeft, scrollTop: el.scrollTop,
      container: { x: left, y: top, right, bottom, visual_scale: { x: sx, y: sy } },
      target: { x: t.x, y: t.y, right: t.right, bottom: t.bottom, width: t.width, height: t.height },
      client: { width: el.clientWidth, height: el.clientHeight },
      scroll: { width: el.scrollWidth, height: el.scrollHeight }
    };
  }, check.target);
  const initial = await measure();
  if (!initial.target_present) return { ...initial, visible: false, steps: [], delta: 0, status: 'FAIL_TARGET_ABSENT', restored: false };
  const initialPosition = axis === 'x' ? initial.scrollLeft : initial.scrollTop;
  const steps = [];
  let current = initial;
  for (let index = 0; index < maxSteps; index++) {
    const currentPosition = axis === 'x' ? current.scrollLeft : current.scrollTop;
    const moved = Math.abs(currentPosition - initialPosition);
    if (current.visible && (moved >= minimumDelta || minimumDelta === 0)) break;
    const content = current.container;
    let direction;
    if (axis === 'y') direction = current.target.bottom > content.bottom + 1 ? 1 : current.target.y < content.y - 1 ? -1 : 1;
    else direction = current.target.right > content.right + 1 ? 1 : current.target.x < content.x - 1 ? -1 : 1;
    await page.mouse.move(hitPoint.point.x, hitPoint.point.y);
    await page.mouse.wheel(axis === 'x' ? direction * wheelDelta : 0, axis === 'y' ? direction * wheelDelta : 0);
    if (pause) await page.waitForTimeout(pause);
    const next = await measure();
    const nextPosition = axis === 'x' ? next.scrollLeft : next.scrollTop;
    steps.push({ index: index + 1, before: currentPosition, after: nextPosition, target_visible: next.visible, target: next.target });
    if (Math.abs(nextPosition - currentPosition) < 0.5) { current = next; break; }
    current = next;
    if (current.visible && Math.abs(nextPosition - initialPosition) >= minimumDelta) break;
  }
  const final = current;
  const finalPosition = axis === 'x' ? final.scrollLeft : final.scrollTop;
  const delta = finalPosition - initialPosition;
  const status = final.target_present && final.visible && Math.abs(delta) >= minimumDelta ? 'PASS' : 'FAIL';
  await container.evaluate((el, pos) => { if (pos.axis === 'x') el.scrollLeft = pos.value; else el.scrollTop = pos.value; }, { axis, value: initialPosition });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const restoredPosition = await container.evaluate((el, dim) => dim === 'x' ? el.scrollLeft : el.scrollTop, axis);
  return {
    target_present: final.target_present, visible: final.visible, initial_visible: initial.visible,
    scrollLeft: final.scrollLeft, scrollTop: final.scrollTop, delta, steps,
    container: final.container, target: final.target, wheel_point: hitPoint, client: final.client, scroll: final.scroll,
    max_steps: maxSteps, restored: Math.abs(restoredPosition - initialPosition) < 0.5, restored_position: restoredPosition,
    status: status === 'PASS' && Math.abs(restoredPosition - initialPosition) < 0.5 ? 'PASS' : 'FAIL'
  };
}

function validate(spec, specPath) {
  if (!spec || spec.schema !== VERSION || !Array.isArray(spec.routes) || !spec.routes.length) fail('BLOCKED', 'invalid schema or no routes');
  if (typeof spec.profile_path !== 'string' || !spec.profile_path) fail('BLOCKED', 'a source-bound project profile is required');
  if (!SHA.test(spec.profile_sha256 || '')) fail('BLOCKED', 'an exact project profile SHA-256 is required');
  const base = new URL(spec.base_url);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) fail('BLOCKED', 'base_url must be credential-free HTTP(S)');
  if (!flag('--allow-remote') && !isLoopback(base.hostname)) fail('BLOCKED', 'remote origin is denied by default');
  const origins = new Set((spec.allowed_origins || [base.origin]).map(x => new URL(x).origin));
  if (!origins.has(base.origin)) fail('BLOCKED', 'base_url origin is not in allowed_origins');
  if (!flag('--allow-remote') && [...origins].some(x => !isLoopback(new URL(x).hostname))) fail('BLOCKED', 'remote allowed origin requires --allow-remote');
  const hasActive = spec.routes.some(r => (r.actions || []).some(a => ['click', 'fill', 'press', 'hover'].includes(a.type)) || (r.temporal?.trigger_action) || (r.focus_sequence || []).length || (r.scroll_containment || []).length);
  if (hasActive && !flag('--allow-interactions')) fail('BLOCKED', 'UI interaction requires --allow-interactions');
  if (flag('--allow-writes') && !flag('--allow-interactions')) fail('BLOCKED', '--allow-writes requires --allow-interactions');
  if (flag('--allow-writes') && spec.isolated_nonproduction !== true) fail('BLOCKED', '--allow-writes requires isolated_nonproduction=true in the request');
  const seen = new Set();
  for (const route of spec.routes) {
    if (!safeName(route.name) || seen.has(route.name)) fail('BLOCKED', 'route names must be unique safe filenames');
    seen.add(route.name);
    if (typeof route.path !== 'string' || !route.path.startsWith('/') || route.path.startsWith('//')) fail('BLOCKED', 'route path must be same-origin absolute path');
    const url = new URL(route.path, base);
    if (url.origin !== base.origin) fail('BLOCKED', 'route path escaped the approved origin');
    if (!route.viewport || !Number.isInteger(route.viewport.width) || !Number.isInteger(route.viewport.height) || route.viewport.width < 200 || route.viewport.height < 200) fail('BLOCKED', 'invalid viewport');
    if (route.state_contract !== undefined && !safeName(route.state_contract)) fail('BLOCKED', 'route state_contract must be a safe project-profile state name');
    if (route.focus_sequence_stage !== undefined && !['before_actions','after_actions'].includes(route.focus_sequence_stage)) fail('BLOCKED', 'focus_sequence_stage must be before_actions or after_actions');
    for (const action of route.actions || []) {
      if (!['click', 'fill', 'press', 'hover', 'wait', 'expect_visible', 'expect_text', 'focus', 'scroll_into_view'].includes(action.type) || typeof action.selector !== 'string') fail('BLOCKED', 'unsupported or unbound browser action');
      if (action.block !== undefined && !['start','center','end','nearest'].includes(action.block)) fail('BLOCKED', 'scroll_into_view block must be start, center, end, or nearest');
      if (action.inline !== undefined && !['start','center','end','nearest'].includes(action.inline)) fail('BLOCKED', 'scroll_into_view inline must be start, center, end, or nearest');
    }
    for (const step of route.focus_sequence || []) {
      if (!step || typeof step.selector !== 'string' || !step.selector || (step.start !== undefined && typeof step.start !== 'string')) fail('BLOCKED', 'focus_sequence entries require a selector and optional string start');
      if (step.activate && (typeof step.activate.target !== 'string' || !['Enter','Space'].includes(step.activate.key || 'Enter'))) fail('BLOCKED', 'focus activation requires a declared target and supported native activation key');
      if (step.settle_ms !== undefined && (!Number.isInteger(step.settle_ms) || step.settle_ms < 0 || step.settle_ms > 2000)) fail('BLOCKED', 'focus settle_ms must be an integer from 0 through 2000');
    }
    if (route.temporal?.trigger_action && (route.temporal.trigger_action.type!=='click' || typeof route.temporal.trigger_action.selector!=='string')) fail('BLOCKED', 'temporal trigger must be a declared click target');
    if (route.temporal?.trigger_prepare && (route.temporal.trigger_prepare.type!=='click' || typeof route.temporal.trigger_prepare.selector!=='string')) fail('BLOCKED', 'temporal preparation must be a declared click target');
    if (route.temporal && (!Number.isInteger(route.temporal.duration_ms) || route.temporal.duration_ms < 1 || route.temporal.duration_ms > 10000 || !Number.isInteger(route.temporal.sample_interval_ms||50) || (route.temporal.sample_interval_ms||50)<10 || (route.temporal.sample_interval_ms||50)>1000)) fail('BLOCKED', 'temporal duration must be 1..10000ms and sample interval 10..1000ms');
    if (route.temporal?.capture_route_actions !== undefined && typeof route.temporal.capture_route_actions !== 'boolean') fail('BLOCKED', 'route temporal capture_route_actions must be boolean');
  }
  return { base, origins, specDir: path.dirname(specPath) };
}

function sourceBinding(spec, specDir) {
  const root = resolveFrom(specDir, spec.source_root || '.');
  if (!fs.statSync(root).isDirectory()) fail('BLOCKED', 'source_root is not a directory');
  let profilePath = null, profile = {}, profileSha = null;
  if (spec.profile_path) {
    profilePath = resolveFrom(specDir, spec.profile_path);
    const bytes = fs.readFileSync(profilePath);
    profile = JSON.parse(bytes.toString('utf8'));
    profileSha = hash(bytes);
    if (spec.profile_sha256 && spec.profile_sha256 !== profileSha) fail('BLOCKED', 'project profile digest mismatch');
  }
  const profileBound = profile.source_files_sha256 || profile.source_bindings || {};
  const bound = { ...profileBound, ...(spec.source_files_sha256 || {}) };
  const verified = [];
  for (const [rel, expectedValue] of Object.entries(bound)) {
    const expected = typeof expectedValue === 'string' ? { sha256: expectedValue } : expectedValue;
    const target = path.resolve(root, rel);
    if (!target.startsWith(root + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) fail('BLOCKED', 'unsafe or missing profile source binding: ' + rel);
    const actual = fileHash(target);
    if (!SHA.test(expected.sha256 || '') || actual !== expected.sha256) fail('BLOCKED', 'profile source hash mismatch: ' + rel);
    if (expected.mode !== undefined && (fs.statSync(target).mode & 0o777) !== expected.mode) fail('BLOCKED', 'profile source mode mismatch: ' + rel);
    verified.push({ path: rel, sha256: actual, mode: fs.statSync(target).mode & 0o777 });
  }
  if (!verified.length) fail('BLOCKED', 'at least one source file must be SHA-256 bound by the project profile or request');
  const bindingsHash = verified.length ? hash(Buffer.from(JSON.stringify(verified))) : null;
  return { root, profile, profilePath, profileSha, verified, bindingsHash,
    status: verified.length ? 'PASS_REFERENCED_FILES_MATCH' : 'DECLARED_PROFILE_NO_SOURCE_FILE_BINDINGS' };
}

export const ANALYZE = async (policy) => {
  const tol = Number(policy.tolerance_css_px ?? 1);
  const minArea = Number(policy.minimum_collision_area_css_px ?? 4);
  const visible = (el) => {
    if (!(el instanceof Element)) return false;
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || Number(s.opacity) <= 0.001 || r.width <= 0 || r.height <= 0) return false;
    for (let p=el.parentElement;p;p=p.parentElement) if (getComputedStyle(p).display==='none' || getComputedStyle(p).visibility==='hidden' || Number(getComputedStyle(p).opacity)<=0.001) return false;
    return true;
  };
  // Accessibility-only descriptions (for example Tailwind's sr-only text in
  // a tooltip trigger) participate in the accessibility tree, not rendered
  // geometry. Do not treat their deliberately clipped 1px box as visible ink.
  // Keep this narrow: ordinary small controls and offscreen skip links do not
  // match the absolute/fixed + clipped + <=1px pattern.
  const accessibilityOnly = (el) => {
    if (!(el instanceof Element)) return false;
    const s=getComputedStyle(el), r=el.getBoundingClientRect();
    if (!['absolute','fixed'].includes(s.position) || !['hidden','clip'].includes(s.overflowX) || !['hidden','clip'].includes(s.overflowY)) return false;
    if (el.clientWidth>1 || el.clientHeight>1 || r.width>2 || r.height>2) return false;
    const clippedPath=s.clipPath!=='none' && /inset\(\s*50%/.test(s.clipPath);
    const clippedRect=s.clip!=='auto' && /rect\(\s*0(?:px)?\s*,\s*0(?:px)?\s*,\s*0(?:px)?\s*,\s*0(?:px)?\s*\)/.test(s.clip);
    return clippedPath || clippedRect || (parseFloat(s.width)<=1 && parseFloat(s.height)<=1);
  };
  const accessibilityOnlyText = (node) => {
    for (let p=node?.parentElement;p&&p!==document.body;p=p.parentElement) if (accessibilityOnly(p)) return true;
    return false;
  };
  const css = (el) => {
    if (!el) return 'unknown';
    if (el.id) return '#' + CSS.escape(el.id);
    const testid = el.getAttribute('data-testid'); if (testid && document.querySelectorAll('[data-testid="' + CSS.escape(testid) + '"]').length===1) return '[data-testid="' + CSS.escape(testid) + '"]';
    const pieces=[]; let current=el;
    while(current && current!==document.documentElement) {
      if(current.id) { pieces.unshift('#'+CSS.escape(current.id)); break; }
      const tag=current.tagName.toLowerCase(), siblings=current.parentElement?[...current.parentElement.children].filter(x=>x.tagName===current.tagName):[];
      pieces.unshift(siblings.length>1?tag+':nth-of-type('+(siblings.indexOf(current)+1)+')':tag);
      current=current.parentElement;
    }
    return pieces.join(' > ');
  };
  const owner = (el) => el.closest('[data-golden-text],h1,h2,h3,h4,h5,h6,p,label,button,a,li,td,th,dt,dd,legend,summary') || el;
  const box = (r) => ({x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom});
  const overlap = (a,b) => ({width:Math.max(0,Math.min(a.right,b.right)-Math.max(a.x,b.x)),height:Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y))});
  const allowedPair = (a,b) => (policy.allowed_overlaps || []).some(x => {
    try { return (a.matches(x.a) && b.matches(x.b)) || (a.matches(x.b) && b.matches(x.a)); } catch { return false; }
  });
  const truncAllowed = (el) => (policy.intentional_truncation || []).find(x => { try { return el.matches(x.selector); } catch { return false; } });
  const normalizedText = value => String(value || '').replace(/\s+/g, ' ').trim();
  const accessibleName = el => {
    if (!el) return '';
    const labelledby=(el.getAttribute('aria-labelledby')||'').split(/\s+/).filter(Boolean);
    if (labelledby.length) {
      const refs=labelledby.map(id=>document.getElementById(id)).filter(Boolean);
      if (refs.length===labelledby.length) return normalizedText(refs.map(ref=>ref.innerText||ref.textContent||'').join(' '));
    }
    const aria=el.getAttribute('aria-label'); if (aria) return normalizedText(aria);
    if (el.labels?.length) return normalizedText([...el.labels].map(label=>label.innerText||label.textContent||'').join(' '));
    return normalizedText(el.innerText||el.textContent||el.getAttribute('title')||'');
  };
  const hasRenderedEllipsis = (el, fullText) => [el,...el.querySelectorAll('*')].some(candidate=>{
    const s=getComputedStyle(candidate);
    if (s.textOverflow!=='ellipsis') return false;
    // Chromium innerText may expose the visually elided string. Keep the DOM
    // source as the full-value evidence, then require rendered CSS overflow.
    const content=normalizedText(candidate.textContent||candidate.innerText||'');
    return !!content && content.includes(fullText) && candidate.clientWidth>0 && candidate.scrollWidth>candidate.clientWidth+tol;
  });
  const accessibilityTreeHidden = (el) => {
    for(let p=el;p;p=p.parentElement){
      if((p.getAttribute('aria-hidden')||'').trim().toLowerCase()==='true'||p.hasAttribute('inert'))return true;
    }
    return false;
  };
  const truncDisclosure = (el, fullText='', visualSource=el) => {
    if (!el) return null;
    const rule=truncAllowed(el);
    const explicit=!!rule && rule.keyboard_discoverable===true && rule.exact_content_available===true && (policy.keyboard_verified_selectors||[]).includes(css(el));
    const control=el.closest('button,a[href],input,select,textarea,summary,[role="button"],[role="gridcell"]') || el;
    if (!visible(control) || control.matches(':disabled,[aria-disabled="true"]') || control.tabIndex<0) return null;
    const name=accessibleName(control), required=normalizedText(fullText);
    if (!name || !required || !name.includes(required) || !hasRenderedEllipsis(visualSource,required)) return null;
    return {status:explicit?'PASS_SOURCE_DECLARED_DISCLOSURE':'PASS_EXACT_KEYBOARD_ACCESSIBLE_NAME',control:css(control),name_source:control.hasAttribute('aria-label')?'aria-label':control.hasAttribute('aria-labelledby')?'aria-labelledby':control.labels?.length?'associated-label':'native-accessible-content',required_text:required,accessible_name:name};
  };
  const semanticCellEllipsis = (el, fullText='', visualSource=el) => {
    const required=normalizedText(fullText);
    const cell=el?.closest('[role="gridcell"],[role="cell"],td,th');
    const grid=cell?.closest('[role="grid"],[role="treegrid"],[role="table"]');
    if(!required||!visualSource?.id||document.getElementById(visualSource.id)!==visualSource||!visible(visualSource))return null;
    // A cell can expose its full value through native grid navigation, or a
    // keyboard-operable control can explicitly describe the exact text node.
    // Both paths require genuine CSS ellipsis and the full text in the
    // accessible tree; an overflow metric or title tooltip alone is not enough.
    // aria-hidden="false" is explicit evidence that this visible clone remains
    // in the accessibility tree; attribute presence alone is not hiddenness.
    // True-hidden visual copies still cannot prove their own disclosure.
    if(accessibilityTreeHidden(visualSource))return null;
    if(!hasRenderedEllipsis(visualSource,required))return null;
    const cellName=cell&&visible(cell)?accessibleName(cell):'';
    const verifiedGridCell=(policy.keyboard_verified_selectors||[]).map(selector=>{
      try { return document.querySelector(selector); } catch { return null; }
    }).find(focused=>{
      if(!focused||focused.getAttribute('role')!=='gridcell'||focused.closest('[role="grid"],[role="treegrid"],[role="table"]')!==grid||!visible(focused))return false;
      const focusedText=normalizedText(focused.textContent),focusedName=accessibleName(focused);
      return !!focusedText&&!!focusedName&&focusedName.includes(focusedText);
    });
    // A tab stop on a grid container or header proves only that the widget can
    // receive focus; it does not prove users can reach this value. Require a
    // rendered keyboard-verified cell in this same grid, or make this exact
    // cell a native tab stop itself.
    const directlyKeyboardReachable=!!cell&&cell.tabIndex>=0;
    const accessibleThroughGrid=!!cell&&(!!verifiedGridCell||directlyKeyboardReachable)&&cellName.includes(required);
    const disclosure=[...document.querySelectorAll('[aria-describedby]')].find(control=>{
      if(!visible(control)||control.matches(':disabled,[aria-disabled="true"]')||control.tabIndex<0)return false;
      const described=(control.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean);
      return described.includes(visualSource.id)&&!!accessibleName(control);
    });
    if(!accessibleThroughGrid&&!disclosure)return null;
    return {status:'PASS_INTENTIONAL_SEMANTIC_CELL_ELLIPSIS',cell:cell?css(cell):null,grid:grid?css(grid):null,keyboard_verified_cell:verifiedGridCell?css(verifiedGridCell):null,direct_keyboard_cell:directlyKeyboardReachable?css(cell):null,keyboard_disclosure:disclosure?css(disclosure):null,required_text:required,full_text_available_to_assistive_technology:true,rendered_ellipsis:true};
  };
  const semanticCellEllipsisDiagnostics = (el, fullText='', visualSource=el) => {
    const required=normalizedText(fullText), cell=el?.closest('[role="gridcell"],[role="cell"],td,th'), grid=cell?.closest('[role="grid"],[role="treegrid"],[role="table"]');
    const focusEvidence=(policy.keyboard_verified_selectors||[]).map(selector=>{
      let focused=null;try{focused=document.querySelector(selector);}catch{}
      const focusedGrid=focused?.closest('[role="grid"],[role="treegrid"],[role="table"]')||null;
      const focusedText=normalizedText(focused?.textContent), focusedName=focused?accessibleName(focused):'';
      return {selector,found:!!focused,role:focused?.getAttribute('role')||null,visible:focused?visible(focused):false,same_grid:!!focusedGrid&&focusedGrid===grid,focused_text:focusedText,focused_accessible_name:focusedName,accessible_name_covers_focused_text:!!focusedText&&focusedName.includes(focusedText)};
    });
    let hiddenAncestor=null;for(let p=visualSource;p;p=p.parentElement)if((p.getAttribute('aria-hidden')||'').trim().toLowerCase()==='true'||p.hasAttribute('inert')){hiddenAncestor={selector:css(p),tag:p.tagName.toLowerCase(),role:p.getAttribute('role'),aria_hidden:p.getAttribute('aria-hidden'),inert:p.hasAttribute('inert'),class_name:typeof p.className==='string'?p.className:''};break;}
    const cellName=cell&&visible(cell)?accessibleName(cell):'';
    const accessibleEquivalentCells=grid?[...grid.querySelectorAll('[role="gridcell"],[role="cell"],td,th')].filter(candidate=>{
      if(!visible(candidate))return false;
      if(accessibilityTreeHidden(candidate))return false;
      return accessibleName(candidate)===required;
    }).map(candidate=>({selector:css(candidate),role:candidate.getAttribute('role'),accessible_name:accessibleName(candidate),visible:true})):[];
    return {required_text:required,source_id:visualSource?.id||null,source_id_is_live:!!visualSource?.id&&document.getElementById(visualSource.id)===visualSource,source_visible:!!visualSource&&visible(visualSource),rendered_ellipsis:!!visualSource&&hasRenderedEllipsis(visualSource,required),hidden_ancestor:hiddenAncestor,cell:cell?css(cell):null,cell_visible:!!cell&&visible(cell),cell_tab_index:cell?.tabIndex??null,cell_accessible_name:cellName,cell_name_covers_required:cellName.includes(required),grid:grid?css(grid):null,accessible_equivalent_cells:accessibleEquivalentCells,keyboard_focus_evidence:focusEvidence};
  };
  const scopeSelectors=policy.scope_selectors||[];
  const scopeElements=scopeSelectors.map(selector=>{try{return document.querySelector(selector);}catch{return null;}});
  const inScope=(el)=>!scopeSelectors.length||scopeElements.some(root=>root&&(root===el||root.contains(el)));
  const bodyElements=[...document.querySelectorAll('body *')];
  const scrollCandidates=scopeSelectors.length
    ? [...new Set(scopeElements.filter(Boolean).flatMap(root=>[root,...root.querySelectorAll('*')]))]
    : bodyElements;
  const scrollableContent=scrollCandidates.filter(el=>{
    if(!visible(el))return false;
    const style=getComputedStyle(el);
    return (['auto','scroll'].includes(style.overflowX)&&el.scrollWidth>el.clientWidth+tol)
      || (['auto','scroll'].includes(style.overflowY)&&el.scrollHeight>el.clientHeight+tol);
  }).map(el=>{
    const style=getComputedStyle(el);
    return {selector:css(el),scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,
      axes:{x:['auto','scroll'].includes(style.overflowX)&&el.scrollWidth>el.clientWidth+tol,y:['auto','scroll'].includes(style.overflowY)&&el.scrollHeight>el.clientHeight+tol}};
  });
  if(!scopeSelectors.length){
    const pageScroller=document.scrollingElement;
    if(pageScroller&&(pageScroller.scrollWidth>pageScroller.clientWidth+tol||pageScroller.scrollHeight>pageScroller.clientHeight+tol)){
      scrollableContent.unshift({selector:'document.scrollingElement',scrollWidth:pageScroller.scrollWidth,clientWidth:pageScroller.clientWidth,
        scrollHeight:pageScroller.scrollHeight,clientHeight:pageScroller.clientHeight,axes:{x:pageScroller.scrollWidth>pageScroller.clientWidth+tol,y:pageScroller.scrollHeight>pageScroller.clientHeight+tol}});
    }
  }
  const clipChain = (el, includeSelf=false) => {
    const out = [];
    for (let p=includeSelf?el:el.parentElement; p && p !== document.documentElement; p=p.parentElement) {
      const s=getComputedStyle(p), tag=p.tagName?.toLowerCase(), replaced=['img','input','textarea','select','button','video','audio','canvas','iframe','object','embed','svg'].includes(tag);
      // CSS overflow does not clip non-replaced inline boxes. Treating their
      // zero clientWidth/clientHeight as a clip creates false positives for
      // inline grid-cell values whose actual clipping is performed by a
      // surrounding scroll viewport.
      if(s.display==='contents'||(s.display==='inline'&&!replaced))continue;
      const x=['hidden','clip','auto','scroll'].includes(s.overflowX); const y=['hidden','clip','auto','scroll'].includes(s.overflowY);
      if (x || y) { const r=p.getBoundingClientRect(), sx=p.offsetWidth?r.width/p.offsetWidth:1, sy=p.offsetHeight?r.height/p.offsetHeight:1, left=r.x+p.clientLeft*sx, top=r.y+p.clientTop*sy, width=p.clientWidth*sx, height=p.clientHeight*sy; const content={x:left,y:top,right:left+width,bottom:top+height,width,height}; out.push({selector:css(p),rect:content,overflowX:s.overflowX,overflowY:s.overflowY,clipsX:x,clipsY:y,scrollWidth:p.scrollWidth,clientWidth:p.clientWidth,scrollHeight:p.scrollHeight,clientHeight:p.clientHeight,visualScale:{x:sx,y:sy}}); }
      if(out.length)out[out.length-1].el=p;
    }
    return out;
  };
  const publicClip = ({el,...clip}) => clip;
  const visibleRect = (r, chain) => {
    let left=Math.max(0,r.left??r.x), top=Math.max(0,r.top??r.y), right=Math.min(innerWidth,r.right), bottom=Math.min(innerHeight,r.bottom);
    for(const c of chain){if(c.clipsX){left=Math.max(left,c.rect.x);right=Math.min(right,c.rect.right);}if(c.clipsY){top=Math.max(top,c.rect.y);bottom=Math.min(bottom,c.rect.bottom);}}
    return {x:left,y:top,right,bottom,width:Math.max(0,right-left),height:Math.max(0,bottom-top)};
  };
  const svgGlyphRect = node => {
    const text=node?.parentElement;
    if(!text||text.localName!=='tspan'||text.childNodes.length!==1||text.firstChild!==node||typeof text.getExtentOfChar!=='function')return null;
    try{
      const matrix=text.getScreenCTM(), count=text.getNumberOfChars(), value=(node.nodeValue||'').trim().replace(/\s+/g,' ');
      if(!matrix||!count||count!==value.length)return null;
      let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity,inkCharacters=0;
      for(let i=0;i<count;i++){
        if(!value[i].trim())continue;
        const b=text.getExtentOfChar(i); if(!b||b.width<=0||b.height<=0)continue;
        const points=[[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]].map(([x,y])=>({x:matrix.a*x+matrix.c*y+matrix.e,y:matrix.b*x+matrix.d*y+matrix.f}));
        left=Math.min(left,...points.map(p=>p.x));right=Math.max(right,...points.map(p=>p.x));top=Math.min(top,...points.map(p=>p.y));bottom=Math.max(bottom,...points.map(p=>p.y));inkCharacters++;
      }
      if(!inkCharacters||!Number.isFinite(left)||!Number.isFinite(top))return null;
      return {x:left,y:top,left,top,right,bottom,width:right-left,height:bottom-top,measurement:'svg_character_extents'};
    }catch{return null;}
  };
  const canvas=document.createElement('canvas'), fontContext=canvas.getContext('2d');
  const htmlGlyphVerticalRect = (node, rangeRect) => {
    const parent=node?.parentElement;
    if(!parent||!fontContext||!rangeRect)return null;
    try{
      const s=getComputedStyle(parent);
      if(s.writingMode!=='horizontal-tb')return null;
      for(let p=parent;p&&p!==document.documentElement;p=p.parentElement){
        const ps=getComputedStyle(p);
        if(ps.zoom&&ps.zoom!=='1')return null;
        if(ps.transform!=='none'){
          // A translation changes the fragment's screen position, already
          // reflected in Range.getClientRects(). It does not invalidate the
          // font's vertical ink metrics. Scaling/rotation/skew still need a
          // transform-aware renderer and therefore remain UNKNOWN here.
          try{const matrix=new DOMMatrixReadOnly(ps.transform);if(!matrix.is2D||Math.abs(matrix.a-1)>0.001||Math.abs(matrix.d-1)>0.001||Math.abs(matrix.b)>0.001||Math.abs(matrix.c)>0.001)return null;}catch{return null;}
        }
      }
      // Canvas's font shorthand does not accept the computed `font-stretch`
      // percentage in the same position as CSS `font`; including `100%`
      // resets the context silently to its default 10px sans-serif. Use the
      // supported shorthand fields and apply a non-default stretch only when
      // the runtime exposes the corresponding Canvas property.
      const font=[s.fontStyle,s.fontVariant,s.fontWeight,s.fontSize,s.fontFamily].filter(Boolean).join(' ');
      fontContext.font=font;
      if(s.fontStretch&&s.fontStretch!=='100%'&&s.fontStretch!=='normal'){
        if(fontContext.fontStretch===undefined)return null;
        fontContext.fontStretch=s.fontStretch;
      }
      const parsedFontSize=fontContext.font.match(/(?:^|\s)(\d+(?:\.\d+)?)px(?:\s|$)/)?.[1];
      if(!parsedFontSize||Math.abs(Number(parsedFontSize)-parseFloat(s.fontSize))>0.01)return null;
      const m=fontContext.measureText(node.nodeValue||'');
      const values=[m.fontBoundingBoxAscent,m.fontBoundingBoxDescent,m.actualBoundingBoxAscent,m.actualBoundingBoxDescent,parseFloat(s.fontSize)];
      if(values.some(v=>!Number.isFinite(v))||m.fontBoundingBoxAscent+m.fontBoundingBoxDescent<=0)return null;
      const fontBoxHeight=m.fontBoundingBoxAscent+m.fontBoundingBoxDescent;
      // Range rectangles may contain the font's selection box rather than
      // visible glyph ink. Some common control/badge fonts produce a line box
      // a few pixels taller than the typographic font box. Keep the ink
      // estimate within a conservative font-relative band; genuinely clipped
      // glyphs still fail because the resulting ink rectangle crosses the
      // rendered clip edge.
      if(Math.abs(rangeRect.height-fontBoxHeight)>Math.max(4,values[4]*0.35))return null;
      const scale=rangeRect.height/fontBoxHeight, leading=(rangeRect.height-fontBoxHeight)/2;
      const baseline=rangeRect.top+leading+m.fontBoundingBoxAscent*scale;
      const top=baseline-m.actualBoundingBoxAscent*scale, bottom=baseline+m.actualBoundingBoxDescent*scale;
      if(!(bottom>top)||top<rangeRect.top-1||bottom>rangeRect.bottom+1)return null;
      return {x:rangeRect.left??rangeRect.x,y:top,left:rangeRect.left??rangeRect.x,top,right:rangeRect.right??rangeRect.x+rangeRect.width,bottom,width:rangeRect.width,height:bottom-top,measurement:'canvas_font_ink_metrics'};
    }catch{return null;}
  };
  const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const fragmentRect = item => {
    const node=item._textNode;
    if (!node?.isConnected) return null;
    const glyph=svgGlyphRect(node); if(glyph)return glyph;
    const range=document.createRange(); range.selectNodeContents(node);
    const rects=[...range.getClientRects()].filter(r=>r.width>0&&r.height>0);
    const r=rects[item._fragmentIndex];
    return r?(htmlGlyphVerticalRect(node,r)||box(r)):null;
  };
  const contentBox = el => {
    const r=el.getBoundingClientRect(), sx=el.offsetWidth?r.width/el.offsetWidth:1, sy=el.offsetHeight?r.height/el.offsetHeight:1;
    const x=r.x+el.clientLeft*sx, y=r.y+el.clientTop*sy;
    return {x,y,right:x+el.clientWidth*sx,bottom:y+el.clientHeight*sy,width:el.clientWidth*sx,height:el.clientHeight*sy,scaleX:sx,scaleY:sy};
  };
  const positionedAncestor = el => {
    for(let p=el;p&&p!==document.documentElement;p=p.parentElement){const pos=getComputedStyle(p).position;if(pos==='fixed'||pos==='sticky')return p;}
    return null;
  };
  // The document tree is stable during one ANALYZE call. Cache only the
  // candidate surface elements; their current visibility and rect are still
  // re-read after each scroll proof so sticky movement remains observable.
  const positionedSurfaceCandidates = bodyElements.filter(hit => {
    if (!visible(hit) || accessibilityOnly(hit)) return false;
    const position=getComputedStyle(hit).position;
    return position==='fixed'||position==='sticky';
  });
  const positionedOcclusions = (r, target) => {
    if(!r||!target)return [];
    const out=[];
    for(const hit of positionedSurfaceCandidates){
      if(!visible(hit))continue;
      const style=getComputedStyle(hit); if(style.position!=='fixed'&&style.position!=='sticky')continue;
      if(hit===target||hit.contains(target)||target.contains(hit))continue;
      const hr=hit.getBoundingClientRect(), hbox=box(hr), size=overlap(r,hbox), inter={x:Math.max(r.x,hbox.x),y:Math.max(r.y,hbox.y),right:Math.min(r.right,hbox.right),bottom:Math.min(r.bottom,hbox.bottom),width:size.width,height:size.height};
      if(inter.width*inter.height<minArea)continue;
      const points=[[inter.x+inter.width/2,inter.y+inter.height/2],[inter.x+Math.min(2,inter.width/2),inter.y+Math.min(2,inter.height/2)],[inter.right-Math.min(2,inter.width/2),inter.bottom-Math.min(2,inter.height/2)]];
      for(const [x,y] of points){
        if(x<0||y<0||x>=innerWidth||y>=innerHeight)continue;
        const top=document.elementFromPoint(x,y), surface=positionedAncestor(top);
        if(surface&&(surface===hit||hit.contains(top))&&surface!==target&&!surface.contains(target)){
          out.push({selector:css(hit),position:style.position,rect:box(hr),intersection_css_px:inter,hit_target:css(top),sample:{x,y},opacity:Number(style.opacity)}); break;
        }
      }
    }
    return out;
  };
  const proveScrollReachability = async item => {
    const before=fragmentRect(item); if(!before)return {status:'UNKNOWN',reason:'rendered text range disappeared before scroll proof'};
    const saved=[], seen=new Set();
    for(let p=item._textParent;p&&p!==document.documentElement;p=p.parentElement){
      const s=getComputedStyle(p), x=['auto','scroll'].includes(s.overflowX)&&p.scrollWidth>p.clientWidth+tol, y=['auto','scroll'].includes(s.overflowY)&&p.scrollHeight>p.clientHeight+tol;
      if((x||y)&&!seen.has(p)){saved.push({el:p,left:p.scrollLeft,top:p.scrollTop,x,y,scrollBehavior:p.style.getPropertyValue('scroll-behavior'),scrollBehaviorPriority:p.style.getPropertyPriority('scroll-behavior')});seen.add(p);}
    }
    const pageScroller=document.scrollingElement;
    if(pageScroller&&((pageScroller.scrollWidth>pageScroller.clientWidth+tol)||(pageScroller.scrollHeight>pageScroller.clientHeight+tol))&&!seen.has(pageScroller)){
      saved.push({el:pageScroller,left:pageScroller.scrollLeft,top:pageScroller.scrollTop,x:pageScroller.scrollWidth>pageScroller.clientWidth+tol,y:pageScroller.scrollHeight>pageScroller.clientHeight+tol,page:true,scrollBehavior:pageScroller.style.getPropertyValue('scroll-behavior'),scrollBehaviorPriority:pageScroller.style.getPropertyPriority('scroll-behavior')});seen.add(pageScroller);
    }
    // Semantic grids can synchronize a visible horizontal scroll viewport
    // with a clipped header/body viewport that is not its DOM ancestor. Only
    // consider this path inside one ARIA grid/treegrid and require matching
    // rendered horizontal viewport bounds; unrelated carousels cannot excuse
    // clipped text.
    const gridRoot=item._textParent?.closest('[role="grid"],[role="treegrid"]');
    if(gridRoot){
      const beforeChain=clipChain(item._textParent,true);
      const horizontalClips=beforeChain.filter(c=>c.clipsX&&(before.left<c.rect.x-tol||before.right>c.rect.right+tol));
      if(horizontalClips.length){
        for(const candidate of gridRoot.querySelectorAll('*')){
          if(seen.has(candidate))continue;
          const s=getComputedStyle(candidate),scrollable=['auto','scroll'].includes(s.overflowX)&&candidate.scrollWidth>candidate.clientWidth+tol;
          if(!scrollable||candidate.clientWidth<=0||!visible(candidate))continue;
          const viewport=contentBox(candidate);
          if(!horizontalClips.some(c=>Math.abs(viewport.x-c.rect.x)<=tol&&Math.abs(viewport.right-c.rect.right)<=tol))continue;
          saved.push({el:candidate,left:candidate.scrollLeft,top:candidate.scrollTop,x:true,y:false,linked:true,scrollBehavior:candidate.style.getPropertyValue('scroll-behavior'),scrollBehaviorPriority:candidate.style.getPropertyPriority('scroll-behavior')});seen.add(candidate);
        }
      }
    }
    for(const entry of saved)entry.el.style.setProperty('scroll-behavior','auto','important');
    if(saved.length)await nextFrame();
    const changes=[]; let result;
    try{
      for(let pass=0;pass<=saved.length;pass++){
        let passChanged=false;
        for(const entry of saved){
          const r=fragmentRect(item); if(!r)break;
          const b=entry.page?{x:0,y:0,right:innerWidth,bottom:innerHeight,width:innerWidth,height:innerHeight,scaleX:1,scaleY:1}:contentBox(entry.el);
          // A scrollport can extend slightly beyond a clipped parent (common
          // in dense tables). Content may be reachable inside the scrollport
          // yet still hidden at the parent's edge. Align against the
          // intersection of this scrollport, the viewport, and every clipping
          // ancestor above the scrollport before deciding that the text is
          // immovably clipped.
          let allowed={x:b.x,y:b.y,right:b.right,bottom:b.bottom,width:b.width,height:b.height};
          const boundaryClips=entry.page?[]:clipChain(item._textParent,true).filter(c=>c.el&&c.el!==entry.el&&c.el.contains(entry.el));
          const intersect=(rect)=>{allowed={x:Math.max(allowed.x,rect.x),y:Math.max(allowed.y,rect.y),right:Math.min(allowed.right,rect.right),bottom:Math.min(allowed.bottom,rect.bottom)};allowed.width=Math.max(0,allowed.right-allowed.x);allowed.height=Math.max(0,allowed.bottom-allowed.y);};
          intersect({x:0,y:0,right:innerWidth,bottom:innerHeight});
          for(const clip of boundaryClips)intersect(clip.rect);
          const left=r.left??r.x, top=r.top??r.y;
          let dx=0,dy=0;
          if(allowed.width>0&&entry.x&&r.width<=allowed.width+tol)dx=left<allowed.x-tol?left-allowed.x:r.right>allowed.right+tol?r.right-allowed.right:0;
          if(allowed.height>0&&entry.y&&r.height<=allowed.height+tol)dy=top<allowed.y-tol?top-allowed.y:r.bottom>allowed.bottom+tol?r.bottom-allowed.bottom:0;
          const oldLeft=entry.el.scrollLeft,oldTop=entry.el.scrollTop;
          if(entry.page){if(dx||dy){window.scrollBy(dx,dy);}}else{if(dx)entry.el.scrollLeft+=dx/b.scaleX;if(dy)entry.el.scrollTop+=dy/b.scaleY;}
          const changed=Math.abs(entry.el.scrollLeft-oldLeft)>0.1||Math.abs(entry.el.scrollTop-oldTop)>0.1;
          if(changed){passChanged=true;await nextFrame();}
          changes.push({selector:entry.page?'document.scrollingElement':css(entry.el),before:{left:oldLeft,top:oldTop},after:{left:entry.el.scrollLeft,top:entry.el.scrollTop},x_scrollable:entry.x,y_scrollable:entry.y,linked:entry.linked===true,pass});
        }
        if(!passChanged)break;
      }
      const after=fragmentRect(item), chain=clipChain(item._textParent,true), clipped=after?visibleRect(after,chain):null;
      const fullyVisible=!!after&&!!clipped&&clipped.width>=after.width-tol&&clipped.height>=after.height-tol;
      const occlusions=after?positionedOcclusions(after,item._textParent):[];
      const remaining=after?chain.filter(c=>(c.clipsX&&(after.x<c.rect.x-tol||after.right>c.rect.right+tol))||(c.clipsY&&(after.y<c.rect.y-tol||after.bottom>c.rect.bottom+tol))):[];
      const immovable=remaining.filter(c=>(c.clipsX&&['hidden','clip'].includes(c.overflowX)&&(after.x<c.rect.x-tol||after.right>c.rect.right+tol))||(c.clipsY&&['hidden','clip'].includes(c.overflowY)&&(after.y<c.rect.y-tol||after.bottom>c.rect.bottom+tol)));
      result={status:!fullyVisible?(immovable.length?'FAIL_CLIPPED_BY_NONSCROLLABLE_ANCESTOR':'FAIL_STILL_CLIPPED_AFTER_SCROLL'):occlusions.length?'FAIL_OCCLUDED_AFTER_SCROLL':changes.some(c=>c.before.left!==c.after.left||c.before.top!==c.after.top)?(changes.some(c=>c.linked&&c.before.left!==c.after.left)?'PASS_REACHABLE_BY_LINKED_SCROLL':'PASS_REACHABLE_BY_SCROLL'):'PASS_VISIBLE_AFTER_LAYOUT',before_rect:before,after_rect:after,after_visible_rect:clipped,scroll_changes:changes,remaining_clipping_ancestors:remaining.map(c=>({selector:c.selector,overflowX:c.overflowX,overflowY:c.overflowY,rect:c.rect})),positioned_occlusions:occlusions};
    }finally{
      for(const entry of saved){entry.el.scrollLeft=entry.left;entry.el.scrollTop=entry.top;}
      await nextFrame();
      for(const entry of saved){if(entry.scrollBehavior)entry.el.style.setProperty('scroll-behavior',entry.scrollBehavior,entry.scrollBehaviorPriority);else entry.el.style.removeProperty('scroll-behavior');}
      if(saved.length)await nextFrame();
    }
    return result;
  };
  const visibleText = [];
  let rangeFragmentCount=0, collisionPairsCompared=0;
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  let node, accessibilityOnlyTextNodesExcluded=0;
  while ((node=walker.nextNode()) && visibleText.length < Number(policy.max_text_fragments || 5000)) {
    if (accessibilityOnlyText(node)) { accessibilityOnlyTextNodesExcluded++; continue; }
    if (!node.nodeValue || !node.nodeValue.trim() || !visible(node.parentElement) || !inScope(node.parentElement)) continue;
    const range=document.createRange(); range.selectNodeContents(node); const rects=[...range.getClientRects()];
    for (let fragmentIndex=0;fragmentIndex<rects.length;fragmentIndex++) { const r=rects[fragmentIndex]; if (r.width>0 && r.height>0) {
      const svgGlyph=rects.length===1?svgGlyphRect(node):null, htmlGlyph=svgGlyph?null:htmlGlyphVerticalRect(node,r), measured=svgGlyph||htmlGlyph||r;
      const own=owner(node.parentElement); const chain=clipChain(node.parentElement,true);
      const clipped=chain.filter(c => (c.clipsX && (measured.left < c.rect.x-tol || measured.right > c.rect.right+tol)) || (c.clipsY && (measured.top < c.rect.y-tol || measured.bottom > c.rect.bottom+tol)));
      visibleText.push({text:node.nodeValue.trim().slice(0,160),owner:css(own),ownerTag:own.tagName.toLowerCase(),measurement:svgGlyph?'svg_character_extents':htmlGlyph?'canvas_font_ink_metrics_vertical':'text_range',text_range_rect:box(r),rect:box(measured),visibleRect:visibleRect(measured,chain),clippingAncestors:clipped.map(publicClip),fullClippingChain:chain.map(publicClip),_clipChain:chain,_ownerEl:own,_textParent:node.parentElement,_textNode:node,_fragmentIndex:fragmentIndex});
      rangeFragmentCount++;
    }}
  }
  const controls=[];
  for (const el of document.querySelectorAll('a[href],button,input,select,textarea,[role="button"],[role="link"],[role="menuitem"],[role="tab"],[tabindex]:not([tabindex="-1"])')) {
    if (!visible(el) || !inScope(el) || el.matches(':disabled,[aria-disabled="true"]')) continue;
    const r=el.getBoundingClientRect(),chain=clipChain(el); controls.push({selector:css(el),tag:el.tagName.toLowerCase(),label:el.getAttribute('aria-label') || el.innerText || el.textContent || '',rect:box(r),visibleRect:visibleRect(r,chain),clippingAncestors:chain.map(publicClip),_el:el});
  }
  const findings=[], nonBlockingControlOverlaps=[]; let nonBlockingControlOverlapCount=0;
  if(scopeSelectors.some((_,i)=>!scopeElements[i])) findings.push({code:'ANALYSIS_SCOPE_SELECTOR_MISSING',severity:'error',selectors:scopeSelectors.filter((_,i)=>!scopeElements[i]),reproduction:'The source-bound profile state selected a rendered analysis scope that is absent.'});
  const frags=visibleText.filter(x=>x.visibleRect.width>0&&x.visibleRect.height>0).slice().sort((a,b)=>a.visibleRect.x-b.visibleRect.x);
  for (let i=0;i<frags.length;i++) {
    const a=frags[i];
    for (let j=i+1;j<frags.length && frags[j].visibleRect.x < a.visibleRect.right-tol;j++) {
      const b=frags[j]; if (a.owner===b.owner) continue;
      collisionPairsCompared++;
      const hit=overlap(a.visibleRect,b.visibleRect), area=hit.width*hit.height;
      const smaller=Math.min(a.visibleRect.width*a.visibleRect.height,b.visibleRect.width*b.visibleRect.height);
      if (area < minArea || (smaller>0 && area/smaller < Number(policy.minimum_collision_fraction??0.12))) continue;
      const ae=a._ownerEl, be=b._ownerEl;
      const permittedOverlay=(policy.permitted_overlay_selectors||[]).some(sel=>{try{const layer=document.querySelector(sel);return layer&&layer.contains(ae)!==layer.contains(be);}catch{return false;}});
      if ((ae && be && allowedPair(ae,be)) || permittedOverlay) continue;
      findings.push({code:'TEXT_TEXT_COLLISION',severity:'error',a:{selector:a.owner,text:a.text,rect:a.rect,visible_rect:a.visibleRect},b:{selector:b.owner,text:b.text,rect:b.rect,visible_rect:b.visibleRect},intersection_css_px:hit,reproduction:'Open this route and viewport; the visible portions of the two text fragments occupy the same rendered CSS-pixel region.'});
    }
  }
  const clippingEvaluations=[];
  const activatedSkipLinks=policy.activated_skip_link_selectors||[];
  for (const t of visibleText) {
    const strictClips=t.clippingAncestors;
    const ownerEl=t._ownerEl;
    let disclosed=truncDisclosure(ownerEl,t.text,t._textParent)||semanticCellEllipsis(ownerEl,t.text,t._textParent);
    if(strictClips.length){
      const activatedSkip=ownerEl?.tagName==='A'&&/^#[^#]/.test(ownerEl.getAttribute('href')||'')&&activatedSkipLinks.some(sel=>{try{return document.querySelector(sel)===ownerEl;}catch{return false;}});
      if(activatedSkip){clippingEvaluations.push({selector:t.owner,text:t.text,status:'PASS_HIDDEN_UNTIL_KEYBOARD_FOCUS_AND_ACTIVATION',initial_rect:t.rect,initial_clipping_ancestors:strictClips.map(c=>({selector:c.selector,overflowX:c.overflowX,overflowY:c.overflowY,rect:c.rect})),proof:'Native Tab reached the source-bound skip link, visible focus was measured, and Enter moved focus to its declared main-content target.'});}
      else if(disclosed){clippingEvaluations.push({selector:t.owner,text:t.text,status:'PASS_INTENTIONAL_TRUNCATION_WITH_KEYBOARD_ACCESSIBLE_NAME',initial_rect:t.rect,initial_clipping_ancestors:strictClips.map(c=>({selector:c.selector,overflowX:c.overflowX,overflowY:c.overflowY,rect:c.rect})),disclosed_intentional_truncation:true,disclosure:disclosed});}
      else {
        let scrollProof;
        try{scrollProof=await proveScrollReachability(t);
        }catch(error){scrollProof={status:'UNKNOWN',reason:String(error).slice(0,240)};}
        disclosed=disclosed || strictClips.some(c=>{try{return truncDisclosure(document.querySelector(c.selector),t.text,t._textParent);}catch{return false;}});
        const passed=scrollProof.status.startsWith('PASS_')||disclosed;
        clippingEvaluations.push({selector:t.owner,text:t.text,status:passed?'PASS_REACHABLE_OR_DISCLOSED':scrollProof.status,initial_rect:t.rect,initial_clipping_ancestors:strictClips.map(c=>({selector:c.selector,overflowX:c.overflowX,overflowY:c.overflowY,rect:c.rect})),scroll_proof:scrollProof,disclosed_intentional_truncation:!!disclosed,disclosure:disclosed||null});
        if(!passed){const unknown=scrollProof.status==='UNKNOWN';findings.push({code:unknown?'TEXT_CLIPPING_MEASUREMENT_UNKNOWN':'TEXT_CLIPPED_BY_ANCESTOR',severity:unknown?'unknown':'error',selector:t.owner,text:t.text,rect:t.rect,ancestors:strictClips.map(c=>({selector:c.selector,overflowX:c.overflowX,overflowY:c.overflowY,rect:c.rect})),scroll_proof:scrollProof,reproduction:'Reproduce the rendered state, scroll every user-scrollable ancestor through its available range, and compare the text Range with viewport and clipping content boxes.'});}
        if(scrollProof.positioned_occlusions?.length)for(const obstruction of scrollProof.positioned_occlusions)findings.push({code:'TEXT_OBSCURED_BY_POSITIONED_SURFACE',severity:'error',selector:t.owner,text:t.text,...obstruction,reproduction:'Scroll the recorded container to the reported after_rect and verify the top hit-tested fixed/sticky surface covers this text fragment.'});
      }
    }
    if (ownerEl && ownerEl!==document.body) {
      const ownerStyle=getComputedStyle(ownerEl), ownerRect=ownerEl.getBoundingClientRect();
      if (ownerStyle.display!=='inline' && ownerStyle.display!=='contents' && ownerStyle.overflowX==='visible' && ownerStyle.overflowY==='visible') {
        const sx=ownerEl.offsetWidth?ownerRect.width/ownerEl.offsetWidth:1, sy=ownerEl.offsetHeight?ownerRect.height/ownerEl.offsetHeight:1;
        const left=ownerRect.left+ownerEl.clientLeft*sx, top=ownerRect.top+ownerEl.clientTop*sy, right=left+ownerEl.clientWidth*sx, bottom=top+ownerEl.clientHeight*sy;
        const exceeds=t.rect.x<left-tol || t.rect.right>right+tol || t.rect.y<top-tol || t.rect.bottom>bottom+tol;
        if (exceeds && !disclosed) findings.push({code:'TEXT_EXCEEDS_CONTAINER_GEOMETRY',severity:'error',selector:t.owner,text:t.text,text_rect:t.rect,usable_content_box:{x:left,y:top,right,bottom},reproduction:'Compare the rendered text range with its owning component content box; the label extends beyond the usable container.'});
      }
    }
    for (const c of controls) {
      const ctrl=c._el; if (!ctrl || (ownerEl && (ctrl===ownerEl || ctrl.contains(ownerEl) || ownerEl.contains(ctrl)))) continue;
      if(t.visibleRect.width<=0||t.visibleRect.height<=0||c.visibleRect.width<=0||c.visibleRect.height<=0) continue;
      const hit=overlap(t.visibleRect,c.visibleRect); if (hit.width*hit.height < minArea || (ownerEl && allowedPair(ownerEl,ctrl))) continue;
      const permittedOverlay=(policy.permitted_overlay_selectors||[]).some(sel=>{try{const layer=document.querySelector(sel);return layer&&layer.contains(ownerEl)!==layer.contains(ctrl);}catch{return false;}});
      if (permittedOverlay) continue;
      const left=Math.max(t.visibleRect.x,c.visibleRect.x),right=Math.min(t.visibleRect.right,c.visibleRect.right),top=Math.max(t.visibleRect.y,c.visibleRect.y),bottom=Math.min(t.visibleRect.bottom,c.visibleRect.bottom);
      const points=[[.5,.5],[.25,.25],[.75,.25],[.25,.75],[.75,.75]].map(([fx,fy])=>({x:Math.max(0,Math.min(innerWidth-1,left+(right-left)*fx)),y:Math.max(0,Math.min(innerHeight-1,top+(bottom-top)*fy))}));
      const hitTests=points.map(point=>{const hitEl=document.elementFromPoint(point.x,point.y);return{...point,hit:hitEl?css(hitEl):null,control_receives_pointer:!!hitEl&&(hitEl===ctrl||ctrl.contains(hitEl))};});
      const controlReceivesPointer=hitTests.some(x=>x.control_receives_pointer);
      if(!controlReceivesPointer){nonBlockingControlOverlapCount++;if(nonBlockingControlOverlaps.length<50)nonBlockingControlOverlaps.push({text:{selector:t.owner,text:t.text},control:c.selector,intersection_css_px:hit,hit_tests:hitTests,classification:'NON_BLOCKING_COMPOSITION_OVERLAP'});continue;}
      findings.push({code:'TEXT_CONTROL_COLLISION',severity:'error',text:{selector:t.owner,text:t.text,rect:t.rect,visible_rect:t.visibleRect},control:{selector:c.selector,label:String(c.label).slice(0,120),rect:c.rect,visible_rect:c.visibleRect},intersection_css_px:hit,hit_tests:hitTests,reproduction:'Open this route and viewport; hit testing shows the control receives pointer input over the overlapping visible text.'});
    }
  }
  const truncation=[],overflowClassifications=[];
  for (const el of bodyElements) if (visible(el) && !accessibilityOnly(el) && inScope(el)) {
    const s=getComputedStyle(el), overX=el.scrollWidth>el.clientWidth+tol;
    if (!overX || (s.textOverflow!=='ellipsis'&&s.overflowX!=='hidden'&&s.overflowX!=='clip')) continue;
    const b=contentBox(el), directText=[...el.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE&&n.nodeValue?.trim());
    const textNodes=[]; const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT); let textNode;
    while((textNode=walker.nextNode()))if(textNode.nodeValue?.trim())textNodes.push(textNode);
    const overflowingText=[];
    for(const n of textNodes){const range=document.createRange();range.selectNodeContents(n);for(const r of range.getClientRects())if(r.width>0&&((r.left<b.x-tol)||(r.right>b.right+tol))){overflowingText.push({text:n.nodeValue.trim().slice(0,100),rect:box(r),outside_right_css_px:Number(Math.max(0,r.right-b.right).toFixed(2)),outside_left_css_px:Number(Math.max(0,b.x-r.left).toFixed(2))});break;}}
    const overflowingChildren=[...el.children].map(child=>{const r=child.getBoundingClientRect();return{selector:css(child),position:getComputedStyle(child).position,rect:box(r)};}).filter(c=>c.rect.x<b.x-tol||c.rect.right>b.right+tol);
    // A scrollable grid viewport can contain descendant text beyond its own
    // box without truncating that text. Only classify this element as a text
    // truncator when the overflowing text node is directly owned by it; nested
    // text is assessed at its own rendered clipping boundary.
    const textOverflow=overflowingText.length>0&&directText.length>0&&(s.textOverflow==='ellipsis'||s.overflowX==='hidden'||s.overflowX==='clip');
    const classification=textOverflow?'TEXT_GLYPHS_EXCEED_CONTENT_BOX':overflowingChildren.length?'NON_TEXT_CHILD_OR_DECORATION_OVERFLOW':'SCROLL_METRIC_WITHOUT_TEXT_CLIP';
    const record={selector:css(el),scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,overflow_css_px:el.scrollWidth-el.clientWidth,overflowX:s.overflowX,textOverflow:s.textOverflow,classification,visible_text_exceeds_box:overflowingText,overflowing_children:overflowingChildren.slice(0,8)};
    overflowClassifications.push(record);
    if(textOverflow){const full=normalizedText(directText.map(n=>n.nodeValue).join(' ')),disclosure=truncDisclosure(el,full,el)||semanticCellEllipsis(el,full,el);const violation={...record,text:full.slice(0,160),disclosure,reason:truncAllowed(el)?.reason||null,...(!disclosure?{semantic_ellipsis_diagnostics:semanticCellEllipsisDiagnostics(el,full,el)}:{})};truncation.push(violation);if(!disclosure)findings.push({code:'TEXT_TRUNCATION_WITHOUT_DISCLOSURE',severity:'error',...violation,reproduction:'The rendered text Range extends beyond this element’s content box; an overflow metric alone is not treated as text truncation.'});}
  }
  const positionedChecked=new Set();
  for(const t of visibleText){
    const obstructions=positionedOcclusions(t.rect,t._textParent);
    for(const obstruction of obstructions){const key=JSON.stringify([t.owner,obstruction.selector,obstruction.sample]);if(positionedChecked.has(key))continue;positionedChecked.add(key);findings.push({code:'TEXT_OBSCURED_BY_POSITIONED_SURFACE',severity:'error',selector:t.owner,text:t.text,...obstruction,reproduction:'At the recorded viewport, an unrelated fixed/sticky surface is the top hit-tested element over this rendered text fragment.'});}
  }
  const pageScrollWidth=Math.max(document.documentElement.scrollWidth,document.body?.scrollWidth||0);
  const pageWidth=pageScrollWidth-document.documentElement.clientWidth;
  if (policy.forbid_page_horizontal_overflow && pageWidth>tol) findings.push({code:'VIEWPORT_HORIZONTAL_OVERFLOW',severity:'error',overflow_css_px:pageWidth,viewport_css_px:document.documentElement.clientWidth,document_css_px:document.documentElement.scrollWidth,body_css_px:document.body?.scrollWidth||0,reproduction:'Open at this viewport; page or body content extends beyond the visible horizontal viewport.'});
  const requiredControls=[];
  for (const sel of policy.required_controls || []) {
    let el; try { el=document.querySelector(sel); } catch { el=null; }
    if (!el) { requiredControls.push({selector:sel,status:'FAIL_MISSING'}); findings.push({code:'REQUIRED_CONTROL_MISSING',severity:'error',selector:sel,reproduction:'The project profile marks this control required, but the selector is absent.'}); continue; }
    if (!inScope(el)) { requiredControls.push({selector:sel,status:'NOT_APPLICABLE_OUTSIDE_ANALYSIS_SCOPE',matched:css(el),scope_selectors:scopeSelectors}); continue; }
    const r=el.getBoundingClientRect(), chain=clipChain(el);
    const clipped=chain.filter(c => (c.clipsX && (r.left<c.rect.x-tol || r.right>c.rect.right+tol)) || (c.clipsY && (r.top<c.rect.y-tol || r.bottom>c.rect.bottom+tol)));
    const outside=r.left < -tol || r.top < -tol || r.right > innerWidth+tol || r.bottom > innerHeight+tol;
    const cx=Math.max(0,Math.min(innerWidth-1,(r.left+r.right)/2)), cy=Math.max(0,Math.min(innerHeight-1,(r.top+r.bottom)/2));
    const hit=document.elementFromPoint(cx,cy); const hitOK=!!hit && (hit===el || el.contains(hit));
    const item={selector:sel,status:outside||clipped.length||!hitOK?'FAIL':'PASS',rect:box(r),clippedBy:clipped,centerHit:hit?css(hit):null}; requiredControls.push(item);
    if (item.status==='FAIL') findings.push({code:'REQUIRED_CONTROL_UNREACHABLE',severity:'error',...item,reproduction:'Use the declared route and viewport; after the runner scrolls the target into view, it remains outside the viewport, clipped, or occluded at its center.'});
  }
  const geometry=[];
  for (const g of policy.geometry_constraints || []) {
    let matches=[]; try { matches=[...document.querySelectorAll(g.selector)]; } catch {}
    if (!matches.length) { geometry.push({selector:g.selector,status:'FAIL_MISSING'}); findings.push({code:'GEOMETRY_TARGET_MISSING',severity:'error',selector:g.selector}); continue; }
    const scoped=matches.filter(inScope);
    if (!scoped.length) { geometry.push({selector:g.selector,status:'NOT_APPLICABLE_SCOPE',matched_count:matches.length}); continue; }
    for(const el of scoped){
      const r=el.getBoundingClientRect(), s=getComputedStyle(el), m={selector:css(el),configured_selector:g.selector,width:r.width,height:r.height,rect:box(r),fontSize:s.fontSize,lineHeight:s.lineHeight,gap:s.gap,padding:{top:s.paddingTop,right:s.paddingRight,bottom:s.paddingBottom,left:s.paddingLeft},status:'PASS'};
      if (g.min_width!=null && r.width < g.min_width-tol) m.status='FAIL';
      if (g.max_width!=null && r.width > g.max_width+tol) m.status='FAIL';
      if (g.min_height!=null && r.height < g.min_height-tol) m.status='FAIL';
      if (g.max_height!=null && r.height > g.max_height+tol) m.status='FAIL';
      const fontSize=parseFloat(s.fontSize), lineHeight=parseFloat(s.lineHeight), gap=parseFloat(s.gap);
      for (const [field,value,min,max] of [['font_size_px',fontSize,g.font_size_min_px,g.font_size_max_px],['line_height_px',lineHeight,g.line_height_min_px,g.line_height_max_px],['gap_px',gap,g.gap_min_px,g.gap_max_px]]) {
        if (min==null&&max==null) continue;
        if (!Number.isFinite(value)) { m.status='UNKNOWN'; m[field]={status:'UNKNOWN',reason:'computed value is not numeric'}; continue; }
        m[field]={value,min:min??null,max:max??null};
        if ((min!=null&&value<min-tol)||(max!=null&&value>max+tol)) m.status='FAIL';
      }
      for (const [side,limits] of Object.entries(g.padding_constraints||{})) {
        const value=parseFloat(s['padding'+side[0].toUpperCase()+side.slice(1)]);
        if (!Number.isFinite(value)) { m.status='UNKNOWN'; continue; }
        if ((limits.min_px!=null&&value<limits.min_px-tol)||(limits.max_px!=null&&value>limits.max_px+tol)) m.status='FAIL';
      }
      if (g.align_with) { const other=document.querySelector(g.align_with.selector); if (!other) { m.status='UNKNOWN'; m.alignment='reference_missing'; }
        else { const q=other.getBoundingClientRect(), axis=g.align_with.axis||'centerY'; const d=axis==='centerY'?Math.abs((r.top+r.bottom-q.top-q.bottom)/2):axis==='centerX'?Math.abs((r.left+r.right-q.left-q.right)/2):axis==='top'?Math.abs(r.top-q.top):Math.abs(r.left-q.left); m.alignment={axis,delta_css_px:d,tolerance_css_px:g.align_with.tolerance_css_px??2}; if (d>(g.align_with.tolerance_css_px??2)) m.status='FAIL'; } }
      geometry.push(m); if (m.status==='FAIL') findings.push({code:'COMPONENT_GEOMETRY_CONSTRAINT',severity:'error',...m,reproduction:'Compare measured rendered bounds with the profile-declared geometry constraint.'}); else if(m.status==='UNKNOWN') findings.push({code:'COMPONENT_GEOMETRY_UNKNOWN',severity:'unknown',...m,reproduction:'The declared geometry invariant could not be measured in this rendered state.'});
    }
  }
  const surfaces=[];
  for (const item of policy.positioned_surfaces || []) {
    const matches=[...document.querySelectorAll(item.selector)].filter(visible);
    if (!matches.length) { surfaces.push({selector:item.selector,status:'NOT_PRESENT'}); if (item.required) findings.push({code:'REQUIRED_SURFACE_MISSING',severity:'error',selector:item.selector}); continue; }
    for (const el of matches) { const r=el.getBoundingClientRect(), inView=r.left>=-tol&&r.top>=-tol&&r.right<=innerWidth+tol&&r.bottom<=innerHeight+tol; const rec={selector:css(el),kind:item.kind,rect:box(r),status:inView?'PASS':'FAIL'}; surfaces.push(rec); if (!inView) findings.push({code:'POSITIONED_SURFACE_OUTSIDE_VIEWPORT',severity:'error',...rec,reproduction:'Open the declared state and viewport; the positioned surface extends outside the viewport.'}); }
  }
  const images=[];
  for (const el of document.querySelectorAll('img')) if (visible(el) && inScope(el)) {
    const r=el.getBoundingClientRect(), s=getComputedStyle(el), natural=(el.naturalWidth>0&&el.naturalHeight>0)?el.naturalWidth/el.naturalHeight:null, rendered=r.width>0&&r.height>0?r.width/r.height:null;
    const distorted=natural!=null&&rendered!=null&&s.objectFit==='fill'&&Math.abs(Math.log(rendered/natural))>Number(policy.image_aspect_log_tolerance??0.03);
    const parent=el.parentElement?.getBoundingClientRect(), allowOverflow=(policy.allow_image_overflow||[]).some(sel=>{try{return el.matches(sel);}catch{return false;}});
    const overflow=parent&&!allowOverflow&&(r.left<parent.left-tol||r.top<parent.top-tol||r.right>parent.right+tol||r.bottom>parent.bottom+tol);
    const rec={selector:css(el),naturalWidth:el.naturalWidth,naturalHeight:el.naturalHeight,renderedWidth:r.width,renderedHeight:r.height,objectFit:s.objectFit,naturalAspect:natural,renderedAspect:rendered,status:natural==null?'UNKNOWN':distorted||overflow?'FAIL':'PASS',parentOverflow:!!overflow}; images.push(rec);
    if (distorted) findings.push({code:'IMAGE_ASPECT_DISTORTION',severity:'error',...rec,reproduction:'Compare intrinsic and rendered image aspect ratios; use preserve-aspect object-fit or an explicit allow rule.'});
    if (overflow) findings.push({code:'IMAGE_OVERFLOWS_PARENT',severity:'error',...rec,reproduction:'Inspect the image and parent bounds in the captured screenshot; the image exceeds its parent.'});
    if (natural==null) findings.push({code:'IMAGE_INTRINSIC_SIZE_UNKNOWN',severity:'unknown',...rec,reproduction:'Wait for the image to load or supply a source whose intrinsic dimensions can be measured.'});
  }
  const iconInventory=[...document.querySelectorAll('svg')].filter(el=>visible(el)&&inScope(el)).map(el=>{
    const r=el.getBoundingClientRect(),s=getComputedStyle(el),vb=el.viewBox?.baseVal,control=el.closest('button,a[href],[role="button"]'),parent=el.parentElement?.getBoundingClientRect();
    return {selector:css(el),rect:box(r),viewBox:vb&&vb.width&&vb.height?{x:vb.x,y:vb.y,width:vb.width,height:vb.height,aspect_ratio:Number((vb.width/vb.height).toFixed(4))}:null,rendered_aspect_ratio:r.height?Number((r.width/r.height).toFixed(4)):null,preserveAspectRatio:el.getAttribute('preserveAspectRatio')||'xMidYMid meet',transform:s.transform,role:el.getAttribute('role'),accessible_name:accessibleName(el),parent:parent?box(parent):null,containing_control:control?css(control):null};
  });
  const icons=[];
  for(const cfg of policy.icon_constraints||[]){
    let matches=[];try{matches=[...document.querySelectorAll(cfg.selector)].filter(el=>visible(el)&&inScope(el));}catch{}
    if(!matches.length){const status=cfg.required?'FAIL_MISSING':'NOT_PRESENT',record={selector:cfg.selector,status};icons.push(record);if(cfg.required)findings.push({code:'ICON_GEOMETRY_TARGET_MISSING',severity:'error',...record,reproduction:'The source-bound icon geometry selector must identify a visible SVG in this rendered state.'});continue;}
    for(const el of matches){const r=el.getBoundingClientRect(),rec={selector:css(el),configured_selector:cfg.selector,rect:box(r),viewBox:el.viewBox?.baseVal&&el.viewBox.baseVal.width&&el.viewBox.baseVal.height?{width:el.viewBox.baseVal.width,height:el.viewBox.baseVal.height}:null,status:'PASS'};
      for(const [field,value,min,max] of [['width',r.width,cfg.min_width,cfg.max_width],['height',r.height,cfg.min_height,cfg.max_height]]){rec[field]=Number(value.toFixed(2));if(min!=null&&value<min-tol||max!=null&&value>max+tol)rec.status='FAIL';}
      if(cfg.align_with){let other=null;try{other=document.querySelector(cfg.align_with.selector);}catch{}if(!other){rec.status='UNKNOWN';rec.alignment={status:'UNKNOWN',reason:'alignment reference is absent'};}else{const q=other.getBoundingClientRect(),axis=cfg.align_with.axis||'centerY',delta=axis==='centerY'?Math.abs((r.top+r.bottom-q.top-q.bottom)/2):axis==='centerX'?Math.abs((r.left+r.right-q.left-q.right)/2):axis==='top'?Math.abs(r.top-q.top):axis==='left'?Math.abs(r.left-q.left):axis==='bottom'?Math.abs(r.bottom-q.bottom):axis==='right'?Math.abs(r.right-q.right):null,allowed=Number(cfg.align_with.tolerance_css_px??2);if(delta===null){rec.status='UNKNOWN';rec.alignment={status:'UNKNOWN',reason:'unsupported alignment axis',axis};}else{rec.alignment={axis,delta_css_px:Number(delta.toFixed(2)),tolerance_css_px:allowed};if(delta>allowed)rec.status='FAIL';}}}
      if(cfg.preserve_aspect===true){const vb=el.viewBox?.baseVal;if(!vb||!vb.width||!vb.height){rec.status='UNKNOWN';rec.aspect_status='UNKNOWN_NO_VIEWBOX';}else if((el.getAttribute('preserveAspectRatio')||'xMidYMid meet').trim().toLowerCase()==='none'&&r.height>0&&Math.abs(Math.log((r.width/r.height)/(vb.width/vb.height)))>Number(cfg.aspect_log_tolerance??0.03)){rec.status='FAIL';rec.aspect_status='FAIL_NONUNIFORM_SVG_SCALING';}else rec.aspect_status='PASS_ASPECT_PRESERVED';}
      icons.push(rec);if(rec.status==='FAIL')findings.push({code:'ICON_GEOMETRY_CONSTRAINT',severity:'error',...rec,reproduction:'Compare the rendered SVG bounds and alignment with the source-bound icon constraint.'});else if(rec.status==='UNKNOWN')findings.push({code:'ICON_GEOMETRY_UNKNOWN',severity:'unknown',...rec,reproduction:'The declared SVG geometry or alignment could not be measured.'});
    }
  }
  const contrast=[];
  const color=(cssColor)=>{ const c=document.createElement('canvas').getContext('2d'); c.clearRect(0,0,1,1); c.fillStyle='rgba(0,0,0,0)'; c.fillStyle=cssColor; c.fillRect(0,0,1,1); return [...c.getImageData(0,0,1,1).data]; };
  const composite=(fg,bg)=>{ const a=fg[3]/255, b=bg[3]/255, outA=a+b*(1-a); if (!outA) return [0,0,0,0]; return [0,1,2].map(i=>Math.round((fg[i]*a+bg[i]*b*(1-a))/outA)).concat([Math.round(outA*255)]); };
  const luminance=rgb=>rgb.slice(0,3).map(v=>{v=v/255;return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4)}).reduce((a,v,i)=>a+v*[0.2126,0.7152,0.0722][i],0);
  const composedBackground=(start)=>{
    let unknown=null;const chain=[];for(let p=start;p;p=p.parentElement)chain.push(p);let bg=[0,0,0,0];
    for(const p of chain){const s=getComputedStyle(p);if(Number(s.opacity)<0.999)unknown='opacity compositing not resolved';if(s.backgroundImage!=='none')unknown='gradient/image background requires pixel sampling';if(s.filter!=='none'||s.mixBlendMode!=='normal')unknown='filter or blend mode requires pixel sampling';}
    try{for(const p of chain.reverse()){const s=getComputedStyle(p),c=color(s.backgroundColor);if(c[3]>0)bg=composite(c,bg);}}catch{unknown='unsupported browser color serialization';}
    return {color:bg,unknown};
  };
  const ratioBetween=(a,b)=>{const l1=luminance(a),l2=luminance(b);return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);};
  for (const cfg of policy.contrast || []) {
    let matched=[];try{matched=[...document.querySelectorAll(cfg.selector)];}catch{}
    if(!matched.length){const rec={selector:cfg.selector,status:'FAIL_MISSING',kind:cfg.kind||'text'};contrast.push(rec);findings.push({code:'CONTRAST_TARGET_MISSING',severity:'error',...rec});continue;}
    const targets=matched.filter(el=>visible(el)&&inScope(el));
    if(!targets.length){const rec={selector:cfg.selector,status:cfg.required?'UNKNOWN':'NOT_APPLICABLE_HIDDEN',kind:cfg.kind||'text',matched_count:matched.length};contrast.push(rec);if(cfg.required)findings.push({code:'CONTRAST_UNKNOWN',severity:'unknown',...rec,reason:'required contrast target is not rendered visibly in this state',reproduction:'Capture the declared interaction state with its required contrast target visible.'});continue;}
    for(const el of targets){
      const kind=cfg.kind||'text';let unknown=null,foreground=null,backgrounds=[],fg=null,property=null;
      if(kind==='text'){
        const composed=composedBackground(el);unknown=composed.unknown;backgrounds=[composed.color];try{fg=color(getComputedStyle(el).color);foreground='color';}catch{unknown='unsupported browser color serialization';}
      }else if(kind==='outline'){
        const style=getComputedStyle(el),hasOutline=style.outlineStyle!=='none'&&parseFloat(style.outlineWidth)>0;
        if(!el.matches(':focus-visible')&&!el.matches(':focus'))unknown='target is not in a rendered keyboard focus state';
        else if(!hasOutline)unknown='focus indicator is not represented by a measurable CSS outline';
        const composed=composedBackground(el.parentElement);unknown=unknown||composed.unknown;backgrounds=[composed.color];property='outlineColor';
        try{fg=color(style.outlineColor);}catch{unknown='unsupported browser outline color serialization';}
      }else if(kind==='boundary'){
        const allowed=new Set(['borderTopColor','borderRightColor','borderBottomColor','borderLeftColor']);property=cfg.property||'borderBottomColor';
        if(!allowed.has(property))unknown='unsupported non-text boundary color property';
        const parentBg=composedBackground(el.parentElement),elementBg=composedBackground(el);unknown=unknown||parentBg.unknown||elementBg.unknown;backgrounds=[parentBg.color,elementBg.color];
        try{fg=color(getComputedStyle(el)[property]);}catch{unknown='unsupported browser boundary color serialization';}
      }else unknown='unsupported rendered contrast kind';
      if(fg&&backgrounds.length)fg=composite(fg,backgrounds[0]);
      if(unknown||!fg||backgrounds.some(bg=>bg[3]<250)){
        const rec={selector:css(el),configured_selector:cfg.selector,kind,status:'UNKNOWN',reason:unknown||'background alpha unresolved',property};contrast.push(rec);findings.push({code:'CONTRAST_UNKNOWN',severity:'unknown',...rec,reproduction:'Resolve the actual rendered color and every adjacent composited background before declaring contrast.'});continue;
      }
      const min=Number(cfg.min_ratio??(kind==='text'?4.5:3));
      const ratios=backgrounds.map(bg=>ratioBetween(fg,bg)),ratio=Math.min(...ratios);
      const rec={selector:css(el),configured_selector:cfg.selector,kind,status:ratio+1e-6>=min?'PASS':'FAIL',ratio:Number(ratio.toFixed(3)),minimum:min,foreground_srgb:fg,background_srgb:backgrounds,property};contrast.push(rec);
      if(rec.status==='FAIL')findings.push({code:'CONTRAST_BELOW_PROFILE_THRESHOLD',severity:'error',...rec,reproduction:'Use the named theme and rendered state; the measured foreground does not meet the profile threshold against one or more adjacent rendered surfaces.'});
    }
  }
  const tokens=[];
  for (const t of policy.design_tokens || []) {
    let tokenScope=document.documentElement;
    if(t.selector){try{tokenScope=document.querySelector(t.selector);}catch{tokenScope=null;}}
    if(!tokenScope){
      const status=t.required?'FAIL_MISSING':'NOT_PRESENT';
      const rec={name:t.name,selector:t.selector,actual:null,expected:t.values_by_theme?.[policy.theme||document.documentElement.dataset.theme||'default']??null,status};
      tokens.push(rec);
      if(t.required)findings.push({code:'DESIGN_TOKEN_SCOPE_MISSING',severity:'error',...rec,reproduction:'The source-bound design-token scope is absent in the rendered state.'});
      continue;
    }
    const actual=getComputedStyle(tokenScope).getPropertyValue(t.name).trim();
    const expected=t.values_by_theme?.[policy.theme || document.documentElement.dataset.theme || 'default'];
    let comparison='exact_string',actualColor=null,expectedColor=null;
    let equivalent=expected!==undefined&&actual===String(expected).trim();
    if(expected!==undefined&&!equivalent){
      try{
        if(CSS.supports('color',actual)&&CSS.supports('color',String(expected))){
          actualColor=color(actual);expectedColor=color(String(expected));
          equivalent=actualColor.every((channel,index)=>channel===expectedColor[index]);
          comparison='rendered_srgb_rgba8';
        }
      }catch{ /* Unsupported or invalid color tokens remain an exact-string mismatch. */ }
    }
    const status=expected===undefined?'UNKNOWN':equivalent?'PASS':'FAIL';
    tokens.push({name:t.name,selector:t.selector||':root',actual,expected:expected??null,status,comparison,...(actualColor?{actual_color_srgb_rgba8:actualColor,expected_color_srgb_rgba8:expectedColor}:{})});
    if (status==='FAIL') findings.push({code:'DESIGN_TOKEN_MISMATCH',severity:'error',name:t.name,selector:t.selector||':root',actual,expected,reproduction:'Compare the computed token on the source-bound theme scope with the project profile value for this route theme.'});
    if (status==='UNKNOWN') findings.push({code:'DESIGN_TOKEN_UNKNOWN',severity:'unknown',name:t.name,selector:t.selector||':root',actual,reproduction:'The project profile has no expected value for this route theme.'});
  }
  if (visibleText.length>=Number(policy.max_text_fragments||5000)) findings.push({code:'TEXT_ANALYSIS_LIMIT_REACHED',severity:'unknown',limit:Number(policy.max_text_fragments||5000),reproduction:'Increase the bounded project-profile text analysis limit or split the route into declared states.'});
  return {viewport:{width:innerWidth,height:innerHeight},document:{scrollWidth:pageScrollWidth,bodyScrollWidth:document.body?.scrollWidth||0,clientWidth:document.documentElement.clientWidth,scrollHeight:Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0),clientHeight:document.documentElement.clientHeight},scope_selectors:scopeSelectors,scrollable_content:scrollableContent,analysis_limit_reached:visibleText.length>=Number(policy.max_text_fragments||5000),text_fragment_count:rangeFragmentCount,accessibility_only_text_nodes_excluded:accessibilityOnlyTextNodesExcluded,collision_pairs_compared:collisionPairsCompared,non_blocking_control_overlap_count:nonBlockingControlOverlapCount,non_blocking_control_overlaps:nonBlockingControlOverlaps,text_fragments:visibleText.map(({_ownerEl,_textParent,_textNode,_fragmentIndex,...x})=>x),controls:controls.map(({_el,...x})=>x),findings,required_controls:requiredControls,truncation,overflow_classifications:overflowClassifications,clipping_evaluations:clippingEvaluations,geometry,surfaces,images,icon_inventory:iconInventory,icons,contrast,tokens};
};

export const FOCUS = (selector) => {
 const el=document.activeElement; const s=getComputedStyle(el); const r=el.getBoundingClientRect();
 const normalize=value=>String(value||'').replace(/\s+/g,' ').trim();
 const labelledby=(el.getAttribute('aria-labelledby')||'').split(/\s+/).filter(Boolean);
 const refs=labelledby.map(id=>document.getElementById(id));
 const name=refs.length&&refs.every(Boolean)?normalize(refs.map(ref=>ref.innerText||ref.textContent||'').join(' ')):el.getAttribute('aria-label')?normalize(el.getAttribute('aria-label')):el.labels?.length?normalize([...el.labels].map(label=>label.innerText||label.textContent||'').join(' ')):normalize(el.innerText||el.textContent||el.getAttribute('title')||'');
 const tabStop=!el.matches(':disabled,[aria-disabled="true"]')&&el.tabIndex>=0&&el.matches('a[href],button,input,select,textarea,summary,[tabindex],audio[controls],video[controls]');
 const selectorFor=target=>{
  if(target.id)return '#'+CSS.escape(target.id);
  const parts=[];
  for(let current=target;current&&current!==document.documentElement;current=current.parentElement){
   if(current.id){parts.unshift('#'+CSS.escape(current.id));break;}
   const tag=current.tagName.toLowerCase(),siblings=current.parentElement?[...current.parentElement.children].filter(node=>node.tagName===current.tagName):[];
   parts.unshift(siblings.length>1?tag+':nth-of-type('+(siblings.indexOf(current)+1)+')':tag);
  }
  return parts.join(' > ');
 };
 const outlineWidth=parseFloat(s.outlineWidth)||0; const outlineVisible=s.outlineStyle!=='none'&&outlineWidth>0&&!/transparent|rgba\([^)]*,\s*0(?:\.0+)?\)/.test(s.outlineColor);
 const shadowVisible=s.boxShadow!=='none'&&!/rgba\([^)]*,\s*0(?:\.0+)?\)/.test(s.boxShadow)&&!s.boxShadow.includes('transparent');
 const sx=el.offsetWidth?r.width/el.offsetWidth:1, sy=el.offsetHeight?r.height/el.offsetHeight:1;
 const shadowValues=(s.boxShadow.match(/-?\d+(?:\.\d+)?px/g)||[]).map(v=>parseFloat(v));
 const shadowExtent=shadowValues.length>=4?Math.max(Math.abs(shadowValues[0]),Math.abs(shadowValues[1]))+Math.max(0,shadowValues[2])+Math.max(0,shadowValues[3]):Math.max(0,...shadowValues.map(Math.abs));
 const extra=outlineVisible?(outlineWidth+(parseFloat(s.outlineOffset)||0))*Math.max(sx,sy):shadowVisible?shadowExtent*Math.max(sx,sy):0; const indicator={x:r.x-extra,y:r.y-extra,right:r.right+extra,bottom:r.bottom+extra};
 const chain=[]; for(let p=el.parentElement;p;p=p.parentElement){const c=getComputedStyle(p);const cx=['hidden','clip','auto','scroll'].includes(c.overflowX),cy=['hidden','clip','auto','scroll'].includes(c.overflowY);if(cx||cy){const b=p.getBoundingClientRect(), psx=p.offsetWidth?b.width/p.offsetWidth:1,psy=p.offsetHeight?b.height/p.offsetHeight:1,left=b.x+p.clientLeft*psx,top=b.y+p.clientTop*psy,clip={x:left,y:top,right:left+p.clientWidth*psx,bottom:top+p.clientHeight*psy};chain.push({selector:p.id?'#'+CSS.escape(p.id):p.tagName.toLowerCase(),overflowX:c.overflowX,overflowY:c.overflowY,clipsX:cx,clipsY:cy,rect:clip,indicator_clipped:(cx&&(indicator.x<clip.x||indicator.right>clip.right))||(cy&&(indicator.y<clip.y||indicator.bottom>clip.bottom))})}}
 const ancestorsVisible=(()=>{for(let p=el;p;p=p.parentElement){const x=getComputedStyle(p);if(x.display==='none'||x.visibility==='hidden'||Number(x.opacity)<=0.001)return false}return true})();
 const viewportClipped=indicator.x < -1 || indicator.y < -1 || indicator.right > innerWidth+1 || indicator.bottom > innerHeight+1;
 const cx=Math.max(0,Math.min(innerWidth-1,(r.left+r.right)/2)),cy=Math.max(0,Math.min(innerHeight-1,(r.top+r.bottom)/2)),hit=document.elementFromPoint(cx,cy);
 const focusHitTest=!!hit&&(hit===el||el.contains(hit));
 const indicatorClipped=chain.some(c=>c.indicator_clipped)||viewportClipped;
 return {active_selector:selectorFor(el),active_tag:el.tagName.toLowerCase(),active_role:el.getAttribute('role'),accessible_name:name,tab_stop:tabStop,expected_match:el.matches(selector),focus_visible:el.matches(':focus-visible'),outline:{style:s.outlineStyle,width:outlineWidth,color:s.outlineColor},box_shadow:s.boxShadow,indicator_visible:ancestorsVisible&&(outlineVisible||shadowVisible)&&focusHitTest,indicator_bounds:indicator,indicator_clipped:indicatorClipped,viewport_clipped:viewportClipped,focus_hit_test:{visible:focusHitTest,top_hit:hit?(hit.id?'#'+CSS.escape(hit.id):hit.tagName.toLowerCase()):null},rect:{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom},clipping_ancestors:chain};
};

export async function openForFocusRestoration(page, check) {
  const target=page.locator(check.open_selector).first();
  if(check.open_key){
    await target.focus({timeout:5000});
    await page.keyboard.press(check.open_key);
    await page.waitForTimeout(Math.max(0,Math.min(2000,Number(check.settle_ms??50))));
    return {type:'focus_restoration_open',selector:check.open_selector,key:check.open_key,status:'EXECUTED'};
  }
  await target.click({timeout:5000});
  await page.waitForTimeout(Math.max(0,Math.min(2000,Number(check.settle_ms??50))));
  return {type:'focus_restoration_open',selector:check.open_selector,status:'EXECUTED'};
}

export async function startRouteActionTransientTrace(page, config) {
  return page.evaluate(cfg=>{
    const selectors=cfg.forbid_transient||[],events=[];let observer=null,timer=null;
    const visible=el=>{if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)<=0.05||r.width<=0||r.height<=0)return false;for(let p=el.parentElement;p;p=p.parentElement){const a=getComputedStyle(p);if(a.display==='none'||a.visibility==='hidden'||Number(a.opacity)<=0.05)return false;}return true;};
    const sample=source=>{for(const selector of selectors){let el=null;try{el=document.querySelector(selector);}catch{}if(visible(el)&&events.length<300){const r=el.getBoundingClientRect();events.push({at_ms:performance.now(),selector,source,opacity:Number(getComputedStyle(el).opacity),rect:{x:r.x,y:r.y,width:r.width,height:r.height}});}}};
    window.__goldenTransientEvents=events;window.__goldenSampleTransient=sample;sample('route_actions_start');
    observer=new MutationObserver(()=>sample('route_action_mutation'));
    observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true});
    timer=setInterval(()=>sample('route_action_interval'),Math.max(10,Math.min(1000,Number(cfg.sample_interval_ms)||40)));
    window.__goldenStopTransientObserver=()=>{observer?.disconnect();if(timer!==null)clearInterval(timer);window.__goldenStopTransientObserver=null;};
    return {status:'STARTED',selector_count:selectors.length};
  },config);
}

export async function stopRouteActionTransientTrace(page) {
  return page.evaluate(()=>{window.__goldenStopTransientObserver?.();return window.__goldenTransientEvents||[];});
}

async function main() {
  const specPath = path.resolve(arg('--spec', ''));
  const output = path.resolve(arg('--output', ''));
  const gzipEvidence=flag('--gzip-evidence');
  if (!specPath || !output || !fs.existsSync(specPath)) fail('BLOCKED', '--spec and --output are required');
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const checked = validate(spec, specPath);
  const source = sourceBinding(spec, checked.specDir);
  if (spec.policy) fail('BLOCKED', 'acceptance policy must come from the source-bound project profile; request-level policy overrides are not allowed');
  const policy = source.profile.visual_enforcement;
  validateVisualPolicy(policy);
  for (const route of spec.routes) if (route.state_contract && !policy.states?.[route.state_contract]) fail('BLOCKED', 'route references an undeclared project-profile state: ' + route.state_contract);
  for (const key of spec.required_checks || []) if (!VISUAL_CHECK_NAMES.includes(key)) fail('BLOCKED', `unsupported required visual check: ${key}`);
  const sourceRoot = source.root;
  if (output === sourceRoot || output.startsWith(sourceRoot + path.sep)) fail('BLOCKED', 'evidence output must be outside application source_root');
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  fs.chmodSync(output, 0o700);
  const projectRoot = resolveFrom(checked.specDir, spec.project_root || spec.source_root || '.');
  if (!spec.runtime?.node_version || spec.runtime.node_version !== process.version) fail('BLOCKED', 'Node.js version differs from the bound approved runtime');
  const requireFromProject = createRequire(path.join(projectRoot, 'package.json'));
  const moduleRequest = arg('--playwright-module', spec.runtime?.playwright_module || 'playwright');
  let playwrightPath;
  try { playwrightPath = requireFromProject.resolve(moduleRequest); } catch { fail('BLOCKED', 'Playwright module unavailable from project_root: ' + moduleRequest); }
  const playwright = requireFromProject(playwrightPath);
  const chromium = playwright.chromium || playwright.default?.chromium;
  if (!chromium) fail('BLOCKED', 'selected Playwright module does not expose Chromium');
  const executable = arg('--browser-executable', spec.runtime?.browser_executable || chromium.executablePath());
  if (!fs.existsSync(executable) || !fs.statSync(executable).isFile()) fail('BLOCKED', 'approved Chromium executable is missing');
  if (!SHA.test(spec.runtime?.browser_executable_sha256 || '') || fileHash(executable)!==spec.runtime.browser_executable_sha256) fail('BLOCKED', 'Chromium executable digest differs from the bound approved runtime');
  let playwrightVersion='UNKNOWN';
  try { playwrightVersion=JSON.parse(fs.readFileSync(path.join(path.dirname(playwrightPath),'package.json'),'utf8')).version; } catch {}
  if (!spec.runtime?.playwright_version || playwrightVersion!==spec.runtime.playwright_version) fail('BLOCKED', 'Playwright version differs from the bound approved runtime');
  if (!SHA.test(spec.runtime?.playwright_entry_sha256 || '') || fileHash(playwrightPath)!==spec.runtime.playwright_entry_sha256) fail('BLOCKED', 'Playwright module entrypoint digest differs from the bound runtime');
  const browser = await chromium.launch({ headless: true, executablePath: executable });
  const report = { schema: VERSION, checker_version: '0.1.0-candidate', created_utc: new Date().toISOString(), status: 'PASS',
    scope: 'Only declared routes, viewports, themes, actions, selectors and profile thresholds are checked. PASS is not aesthetic approval, accessibility certification, or source/collector authentication.',
    request_sha256: fileHash(specPath),
    source_binding: { project_root: sourceRoot, profile_path: source.profilePath, profile_sha256: source.profileSha, verified_profile_source_files: source.verified, verified_profile_source_binding_sha256: source.bindingsHash, status: source.status },
    runtime: { node: process.version, playwright_module: playwrightPath, playwright_entry_sha256: fileHash(playwrightPath), playwright_version: playwrightVersion, chromium_version: browser.version(), browser_executable_sha256: fileHash(executable), executable, websocket_routing: 'REQUIRED' },
    runner_sha256: fileHash(fileURLToPath(import.meta.url)),
    network_policy: { allowed_origins: [...checked.origins], external_requests: 'BLOCKED', mutating_http: flag('--allow-writes') ? 'EXPLICITLY_ALLOWED' : 'BLOCKED', service_workers: 'BLOCKED' },
    unconfigured: [], routes: [] };
  try {
    for (const route of spec.routes) {
      const context = await browser.newContext({ viewport: route.viewport, deviceScaleFactor: route.device_scale_factor || 1, serviceWorkers: 'block', colorScheme: route.color_scheme || 'light', reducedMotion: route.reduced_motion ? 'reduce' : 'no-preference' });
      const violations=[]; const consoleErrors=[]; const pageErrors=[]; let page;
      const routeReport={name:route.name,path:route.path,theme:route.theme||null,viewport:route.viewport,state_contract:route.state_contract||null,actions:[],focus:[],surfaces:[],temporal:null,checks:null,check_coverage:null,findings:[],status:'PASS'};
      try {
        const effective=resolveStatePolicy(policy,route);
        routeReport.effective_policy_sha256=hash(Buffer.from(canonicalJson(effective)));
        if (typeof context.routeWebSocket !== 'function') fail('BLOCKED', 'Playwright routeWebSocket unavailable; refusing browser navigation without socket control');
        await context.routeWebSocket('**/*', socket => { violations.push({code:'WEBSOCKET_ATTEMPT_BLOCKED',url:socket.url()}); socket.close(); });
        await context.route('**/*', async r => {
          const req=r.request(); let origin=''; try { origin=new URL(req.url()).origin; } catch {}
          const method=req.method().toUpperCase();
          if (!checked.origins.has(origin)) { violations.push({code:'EXTERNAL_REQUEST_BLOCKED',origin,url:req.url(),method}); await r.abort(); return; }
          if (!SAFE_METHODS.has(method) && !flag('--allow-writes')) { violations.push({code:'MUTATING_REQUEST_BLOCKED',origin,method,url:req.url()}); await r.abort(); return; }
          await r.continue();
        });
        page=await context.newPage();
        page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text().slice(0,300));});
        page.on('pageerror',e=>pageErrors.push(String(e).slice(0,300)));
        page.on('popup',p=>{violations.push({code:'POPUP_BLOCKED',url:p.url()});p.close();});
        const url=new URL(route.path,checked.base).href;
        await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});
        if (route.wait_for) await page.locator(route.wait_for).first().waitFor({state:'visible',timeout:10000});
        if (effective.temporal?.capture_route_actions === true) {
          await startRouteActionTransientTrace(page,effective.temporal);
        }
        const runFocusSequence = async () => {
        for (const f of effective.focus_sequence || []) {
          if (f.start==='$document') await page.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();window.scrollTo(0,0);});
          else if (f.start && f.start!=='$continue') await page.locator(f.start).first().focus({timeout:5000});
          await page.keyboard.press(f.key||'Tab');
          const presentation=await waitForFocusPresentation(page,f.selector,Number(f.settle_ms||0));
          if(presentation.status==='UNKNOWN_PRESENTATION_DID_NOT_SETTLE')routeReport.findings.push({code:'FOCUS_PRESENTATION_NOT_STABLE',severity:'unknown',expected:f.selector,presentation,reproduction:'Use native keyboard traversal and wait for the target focus presentation to remain stable before measuring visibility.'});
          const value=await page.evaluate(FOCUS,f.selector);
          const observationFindings=focusObservationFindings(value,f.selector);
          for (const finding of observationFindings) routeReport.findings.push({...finding,reproduction: finding.code==='FOCUSED_CONTROL_HAS_NO_ACCESSIBLE_NAME'?'Use native keyboard traversal to reach the control; it must expose a non-empty accessible name to assistive technology.':'From the declared start, use native keyboard traversal; the focused element must be in the viewport, hit-testable, and show an unclipped focus indicator.'});
          let activation=null;
          if(f.activate){
            const authorized=shouldActivateFocusTarget(value);
            if (authorized) {
              await page.keyboard.press(f.activate.key==='Space'?' ':f.activate.key||'Enter');
              await page.waitForTimeout(Math.max(0,Math.min(500,Number(f.activate.settle_ms??50))));
              activation=await page.evaluate(({selector,target,requireFocusTarget})=>{
                const link=document.querySelector(selector),targetEl=document.querySelector(target),href=link?.getAttribute('href')||'',url=link?new URL(link.href,location.href):null,expectedHash=url?.hash||'',targetId=expectedHash.startsWith('#')?decodeURIComponent(expectedHash.slice(1)):null,resolved=targetId?document.getElementById(targetId):null;
                const r=targetEl?.getBoundingClientRect(),visible=!!r&&r.width>0&&r.height>0&&r.right>0&&r.left<innerWidth&&r.bottom>0&&r.top<innerHeight;
                const active=!!targetEl&&document.activeElement===targetEl,hashMatches=!!expectedHash&&location.hash===expectedHash,targetMatches=!!targetEl&&targetEl===resolved;
                return {href,expected_hash:expectedHash,actual_hash:location.hash,target_present:!!targetEl,target_id_matches:targetMatches,target_visible:visible,target_focused:active,require_focus_target:requireFocusTarget===true,status:hashMatches&&targetMatches&&visible&&(requireFocusTarget!==true||active)?'PASS':'FAIL'};
              },{selector:f.selector,target:f.activate.target,requireFocusTarget:f.activate.require_focus_target});
            } else {
              activation={status:'NOT_RUN_FOCUS_TARGET_NOT_CONFIRMED',key:f.activate.key||'Enter',reason:'Native focus did not reach the declared target with a visible, unclipped indicator; activation was withheld.'};
              routeReport.findings.push({code:'FOCUS_ACTIVATION_WITHHELD',severity:'error',expected:f.selector,activation,focus:value,reproduction:'Repeat the declared native focus sequence. The activation key must only be sent when the expected target is focused, visibly indicated and unclipped.'});
            }
          }
          routeReport.focus.push({key:f.key||'Tab',expected:f.selector,presentation,...value,...(activation?{activation}: {})});
          if(activation&&activation.status!=='PASS'&&activation.status!=='NOT_RUN_FOCUS_TARGET_NOT_CONFIRMED')routeReport.findings.push({code:'SKIP_LINK_ACTIVATION_FAILED',severity:'error',expected:f.selector,activation,reproduction:'Focus the declared link with native Tab, press its native activation key, and verify the declared target receives focus and becomes visible.'});
        }
        };
        if (route.focus_sequence_stage === 'before_actions') await runFocusSequence();
        for (const a of route.actions || []) {
          const loc=page.locator(a.selector).first();
          if (a.type==='click') await loc.click({timeout:5000});
          else if (a.type==='fill') await loc.fill(String(a.value??''),{timeout:5000});
          else if (a.type==='press') await loc.press(a.key||'Enter',{timeout:5000});
          else if (a.type==='hover') await loc.hover({timeout:5000});
          else if (a.type==='focus') await loc.focus({timeout:5000});
          else if (a.type==='scroll_into_view') await scrollIntoViewSettled(loc,{block:a.block,inline:a.inline});
          else if (a.type==='wait') await page.waitForTimeout(Math.max(0,Math.min(5000,Number(a.ms)||0)));
          else if (a.type==='expect_visible' && !(await loc.isVisible())) throw new Error('not visible');
          else if (a.type==='expect_text' && !(await loc.innerText()).includes(String(a.text||''))) throw new Error('expected text absent');
          routeReport.actions.push({type:a.type,selector:a.selector,status:'EXECUTED'});
        }
        const required = await page.evaluate(({selectors,scope})=>{
          const roots=scope.map(selector=>{try{return document.querySelector(selector);}catch{return null;}});
          return selectors.filter(selector=>{
            let el=null;try{el=document.querySelector(selector);}catch{}
            return !!el&&(!scope.length||roots.some(root=>root&&(root===el||root.contains(el))));
          });
        },{selectors:effective.required_controls,scope:effective.analysis_scope});
        for (const selector of required) { try { await page.locator(selector).first().scrollIntoViewIfNeeded({timeout:5000}); } catch (e) { routeReport.findings.push({code:'REQUIRED_CONTROL_NOT_REACHABLE',severity:'error',selector,error:String(e).slice(0,200),reproduction:'Use the recorded route and viewport; native locator scrolling could not expose the required control.'}); } }
        for (const check of effective.scroll_containment) {
          let result;
          if (check.method === 'keyboard') {
            const container = page.locator(check.container).first(), target = page.locator(check.target).first();
            const before = await container.evaluate((el,axis)=>axis==='x'?el.scrollLeft:el.scrollTop, check.axis||'y');
            await target.focus({timeout:5000}); await page.keyboard.press(check.key||'PageDown');
            await page.waitForTimeout(Math.max(0,Math.min(1000,Number(check.settle_ms??60))));
            result = await container.evaluate((el,arg)=>{const t=document.querySelector(arg.target);if(!t)return{target_present:false};const a=el.getBoundingClientRect(),b=t.getBoundingClientRect(),sx=el.offsetWidth?a.width/el.offsetWidth:1,sy=el.offsetHeight?a.height/el.offsetHeight:1,left=a.x+el.clientLeft*sx,top=a.y+el.clientTop*sy,right=left+el.clientWidth*sx,bottom=top+el.clientHeight*sy;return{target_present:true,visible:b.left>=left-1&&b.right<=right+1&&b.top>=top-1&&b.bottom<=bottom+1,scrollLeft:el.scrollLeft,scrollTop:el.scrollTop,container:{x:left,y:top,right,bottom,visual_scale:{x:sx,y:sy}},target:{x:b.x,y:b.y,right:b.right,bottom:b.bottom}};},{target:check.target});
            result.delta=(check.axis==='x'?result.scrollLeft:result.scrollTop)-before;
            result.status=result.target_present&&result.visible&&Math.abs(result.delta)>=Number(check.minimum_scroll_delta??0)?'PASS':'FAIL';
            result.restored=false;
          } else {
            result = await scrollContainerToTarget(page, check);
          }
          routeReport.actions.push({type:'scroll_containment',method:check.method||'wheel',container:check.container,target:check.target,...result});
          if(result.status!=='PASS')routeReport.findings.push({code:'SCROLL_CONTAINMENT_FAILURE',severity:'error',container:check.container,target:check.target,...result,reproduction:`Use the recorded route and scroll the declared container to the target. Bounded scrolling tried ${result.steps?.length??1} step(s), measured container movement ${result.delta??0}px, and target visibility ${result.visible?'true':'false'}.`});
        }
        // Check focus return immediately; the subsequent Tab sequence changes focus.
        for (const check of effective.focus_restoration) {
          if(check.open_selector){
            routeReport.actions.push(await openForFocusRestoration(page,check));
          }
          if(effective.positioned_surfaces.length){
            const surfaceRecords=await page.evaluate(items=>{
              const visible=el=>{if(!(el instanceof Element))return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)<=0.001||r.width<=0||r.height<=0)return false;for(let p=el.parentElement;p;p=p.parentElement){const a=getComputedStyle(p);if(a.display==='none'||a.visibility==='hidden'||Number(a.opacity)<=0.001)return false;}return true;};
              const output=[];for(const item of items){let matches=[];try{matches=[...document.querySelectorAll(item.selector)].filter(visible);}catch{}if(!matches.length){output.push({selector:item.selector,kind:item.kind,status:item.required?'FAIL_MISSING':'NOT_PRESENT'});continue;}for(const el of matches){const r=el.getBoundingClientRect(),tol=1,chain=[];for(let p=el.parentElement;p;p=p.parentElement){const s=getComputedStyle(p),cx=['hidden','clip','auto','scroll'].includes(s.overflowX),cy=['hidden','clip','auto','scroll'].includes(s.overflowY);if(!cx&&!cy)continue;const b=p.getBoundingClientRect(),sx=p.offsetWidth?b.width/p.offsetWidth:1,sy=p.offsetHeight?b.height/p.offsetHeight:1,left=b.x+p.clientLeft*sx,top=b.y+p.clientTop*sy,box={x:left,y:top,right:left+p.clientWidth*sx,bottom:top+p.clientHeight*sy};chain.push({overflowX:s.overflowX,overflowY:s.overflowY,rect:box,clipped:(cx&&(r.left<box.x-tol||r.right>box.right+tol))||(cy&&(r.top<box.y-tol||r.bottom>box.bottom+tol))});}const inView=r.left>=-tol&&r.top>=-tol&&r.right<=innerWidth+tol&&r.bottom<=innerHeight+tol,clipped=chain.some(x=>x.clipped);output.push({selector:item.selector,kind:item.kind,rect:{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom},in_viewport:inView,clipped_by_ancestor:clipped,clipping_ancestors:chain,status:inView&&!clipped?'PASS':'FAIL'});}}
              return output;
            },effective.positioned_surfaces);
            for(const surface of surfaceRecords){routeReport.surfaces.push(surface);if(surface.status==='FAIL_MISSING'&&effective.positioned_surfaces.find(x=>x.selector===surface.selector)?.required)routeReport.findings.push({code:'REQUIRED_SURFACE_MISSING',severity:'error',...surface,reproduction:'Open the declared route interaction and confirm the required surface is actually rendered.'});else if(surface.status==='FAIL')routeReport.findings.push({code:'POSITIONED_SURFACE_OUTSIDE_VIEWPORT',severity:'error',...surface,reproduction:'The measured rendered surface is outside the viewport or clipped by an ancestor.'});}
          }
          if(check.dismiss_key){await page.keyboard.press(check.dismiss_key);routeReport.actions.push({type:'focus_restoration_dismiss',key:check.dismiss_key,status:'EXECUTED'});await page.waitForTimeout(Math.max(0,Math.min(2000,Number(check.settle_ms??50))));}
          const measured=await page.evaluate(FOCUS,check.selector);
          const state={active:measured.expected_match,activeTag:measured.active_tag,activeId:await page.evaluate(()=>document.activeElement?.id||null),focus_visible:measured.focus_visible,indicator_visible:measured.indicator_visible,indicator_clipped:measured.indicator_clipped,accessible_name:measured.accessible_name,tab_stop:measured.tab_stop};
          routeReport.focus.push({kind:'restoration',expected:check.selector,open_selector:check.open_selector||null,dismiss_key:check.dismiss_key||null,...state});
          if (!state.active || !state.focus_visible || !state.indicator_visible || state.indicator_clipped) routeReport.findings.push({code:'FOCUS_RESTORATION_FAILED',severity:'error',expected:check.selector,...state,reproduction:'Open the declared control, dismiss it with the declared native key, and verify focus returns to the original trigger with a visible, unclipped keyboard indicator.'});
          if(state.tab_stop&&!state.accessible_name)routeReport.findings.push({code:'FOCUSED_CONTROL_HAS_NO_ACCESSIBLE_NAME',severity:'error',expected:check.selector,...state,reproduction:'The focus-restoration target must retain a meaningful accessible name.'});
        }
        if (route.focus_sequence_stage !== 'before_actions') await runFocusSequence();
        const temporal=effective.temporal;
        if (temporal) {
          const earlyRouteTrace=temporal.capture_route_actions===true&&await page.evaluate(()=>typeof window.__goldenStopTransientObserver==='function');
          if(earlyRouteTrace) await page.evaluate(()=>window.__goldenSampleTransient?.('temporal_start'));
          else await page.evaluate((cfg)=>{
            const selectors=cfg.forbid_transient||[]; const events=[];
            const visible=(el)=>{if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)<=0.05||r.width<=0||r.height<=0)return false;for(let p=el.parentElement;p;p=p.parentElement){const a=getComputedStyle(p);if(a.display==='none'||a.visibility==='hidden'||Number(a.opacity)<=0.05)return false;}return true;};
            const sample=(source)=>{for(const selector of selectors){let el=null;try{el=document.querySelector(selector);}catch{}if(visible(el)){const r=el.getBoundingClientRect();events.push({at_ms:performance.now(),selector,source,opacity:Number(getComputedStyle(el).opacity),rect:{x:r.x,y:r.y,width:r.width,height:r.height}});}}};
            window.__goldenTransientEvents=events;
            const observer=new MutationObserver(()=>sample('mutation'));
            observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true});
            const end=performance.now()+cfg.duration_ms;
            const raf=()=>{sample('animation_frame');if(performance.now()<end)requestAnimationFrame(raf);else observer.disconnect();};
            sample('start');requestAnimationFrame(raf);
          },temporal);
          if (temporal.trigger_prepare) { await page.locator(temporal.trigger_prepare.selector).first().click({timeout:5000}); routeReport.actions.push({type:'temporal_prepare',selector:temporal.trigger_prepare.selector,status:'EXECUTED'}); }
          if (temporal.trigger_action) { await page.locator(temporal.trigger_action.selector).first().click({timeout:5000}); routeReport.actions.push({type:'temporal_trigger',selector:temporal.trigger_action.selector,status:'EXECUTED'}); }
          const frames=[]; const count=Math.max(2,Math.ceil(temporal.duration_ms/(temporal.sample_interval_ms||50)));
          for (let i=0;i<count;i++) { frames.push(await page.evaluate((cfg)=>({at:performance.now(),watched:(cfg.watch||[]).map(item=>{const selector=typeof item==='string'?item:item.selector;const el=document.querySelector(selector);if(!el)return{selector,present:false};const r=el.getBoundingClientRect(),s=getComputedStyle(el);return{selector,present:true,visible:s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0.05,opacity:Number(s.opacity),rect:{x:r.x,y:r.y,width:r.width,height:r.height}}}),forbidden:(cfg.forbid_transient||[]).filter(selector=>{const el=document.querySelector(selector);if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0.05&&r.width>0&&r.height>0})}),temporal));
            if (i<count-1) await page.waitForTimeout(temporal.sample_interval_ms||50);
          }
          const movements=[];
          for(const watched of temporal.watch||[]) {const selector=typeof watched==='string'?watched:watched.selector;const present=frames.map(x=>x.watched.find(y=>y.selector===selector)).filter(x=>x&&x.present); if(present.length>1){const first=present[0].rect;const excursion=Math.max(...present.map(v=>Math.max(Math.abs(v.rect.x-first.x),Math.abs(v.rect.y-first.y),Math.abs(v.rect.width-first.width),Math.abs(v.rect.height-first.height))));const maxFrame=Math.max(...present.slice(1).map((v,i)=>Math.max(Math.abs(v.rect.x-present[i].rect.x),Math.abs(v.rect.y-present[i].rect.y),Math.abs(v.rect.width-present[i].rect.width),Math.abs(v.rect.height-present[i].rect.height))));const allowed=Number((typeof watched==='string'?null:watched.max_movement_css_px)??temporal.max_movement_css_px??2);movements.push({selector,max_excursion_from_initial_css_px:Number(excursion.toFixed(2)),max_frame_movement_css_px:Number(maxFrame.toFixed(2)),allowed_css_px:allowed,reason:typeof watched==='string'?null:(watched.reason||null)});if(excursion>allowed)routeReport.findings.push({code:'UNEXPECTED_LAYOUT_MOVEMENT',severity:'error',...movements[movements.length-1],reproduction:'Replay this route and compare timestamped watched-element rectangles in report.json at route.temporal.frames.'});}}
          const mutationEvents=earlyRouteTrace?await stopRouteActionTransientTrace(page):await page.evaluate(()=>window.__goldenTransientEvents||[]);
          const flashes=frames.flatMap(f=>f.forbidden.map(selector=>({at_ms:f.at,selector})));
          const allFlashEvents=[...flashes,...mutationEvents.map(({at_ms,selector,source})=>({at_ms,selector,source}))];
          if(allFlashEvents.length) routeReport.findings.push({code:'FORBIDDEN_TRANSIENT_OVERLAY',severity:'error',observations:allFlashEvents,reproduction:'Replay the recorded route and inspect temporal frames plus mutation/animation-frame events in report.json at this route.temporal.'});
          const missingWatch=(temporal.watch||[]).map(x=>typeof x==='string'?x:x.selector).filter(selector=>!frames.some(f=>f.watched.some(x=>x.selector===selector&&x.present)));
          if(missingWatch.length)routeReport.findings.push({code:'TEMPORAL_TARGET_MISSING',severity:'error',selectors:missingWatch,reproduction:'A profile-declared temporal watch target was absent throughout the sampled browser trace.'});
          routeReport.temporal={duration_ms:temporal.duration_ms,sample_interval_ms:temporal.sample_interval_ms||50,sample_count:frames.length,mutation_and_animation_event_count:mutationEvents.length,mutation_and_animation_events:mutationEvents,watch_selectors:(temporal.watch||[]).map(x=>typeof x==='string'?x:x.selector),forbidden_selectors:temporal.forbid_transient||[],frames,movements,forbidden_observations:allFlashEvents};
        } else { routeReport.temporal={status:'NOT_RUN'}; }
        // Bind disclosure evidence to the exact element that received native
        // keyboard focus. A broad expected selector can match a different
        // cloned or pinned grid segment (for example, `.ag-cell-focus`).
        const keyboardVerified=routeReport.focus.filter(f=>f.expected&&f.expected_match&&f.focus_visible&&f.indicator_visible&&!f.indicator_clipped).map(f=>f.active_selector);
        const activatedSkipLinks=routeReport.focus.filter(f=>f.expected&&f.expected_match&&f.focus_visible&&f.indicator_visible&&!f.indicator_clipped&&f.activation?.status==='PASS').map(f=>f.expected);
        const measuredDuringRestoration=new Set(routeReport.surfaces.map(x=>x.selector));
        const remainingSurfaces=effective.positioned_surfaces.filter(x=>!measuredDuringRestoration.has(x.selector));
        const checks=await page.evaluate(ANALYZE,{...policy,required_controls:effective.required_controls,scope_selectors:effective.analysis_scope,geometry_constraints:effective.geometry_constraints,positioned_surfaces:remainingSurfaces,contrast:effective.contrast,design_tokens:effective.design_tokens,icon_constraints:effective.icon_constraints,keyboard_verified_selectors:keyboardVerified,activated_skip_link_selectors:activatedSkipLinks,theme:route.theme||policy.theme});
        const scrollProbes=await probeScrollableContent(page,checks.scrollable_content||[]);
        routeReport.actions.push(...scrollProbes);
        for(const probe of scrollProbes){
          if(probe.status==='PASS')continue;
          const uncertain=probe.status.startsWith('UNKNOWN_');
          routeReport.findings.push({code:uncertain?'SCROLL_PROBE_UNKNOWN':'SCROLL_PROBE_FAILED',severity:uncertain?'unknown':'error',...probe,reproduction:`Use native pointer-wheel input over the recorded rendered scroll surface ${probe.selector} on axis ${probe.axis}; confirm it moves and that the original scroll position is restored.`});
        }
        checks.surfaces=[...routeReport.surfaces,...checks.surfaces];routeReport.surfaces=checks.surfaces;
        routeReport.checks=checks; routeReport.findings.push(...checks.findings,...violations);
        routeReport.check_coverage=visualCheckCoverage(effective,checks,routeReport.actions,routeReport.focus,routeReport.temporal);
        routeReport.required_checks=mergeUniqueRecords(effective.mandatory_checks,spec.required_checks||[]);
        for(const name of routeReport.required_checks){
          if(['NOT_CONFIGURED','NOT_RUN'].includes(routeReport.check_coverage[name])){
            routeReport.findings.push({code:'MANDATORY_VISUAL_CHECK_NOT_CONFIGURED',severity:'error',gate:name,state_contract:route.state_contract||null,coverage:routeReport.check_coverage[name],reproduction:'Bind this required check to the source-bound route state and execute it against the rendered route before acceptance.'});
          }
        }
        if (pageErrors.length) routeReport.findings.push(...pageErrors.map(message=>({code:'UNCAUGHT_PAGE_ERROR',severity:'error',message})));
        if (policy.fail_console_errors && consoleErrors.length) routeReport.findings.push(...consoleErrors.map(message=>({code:'BROWSER_CONSOLE_ERROR',severity:'error',message})));
        const shot=path.join(output,route.name+'.png'); await page.screenshot({path:shot,fullPage:!!route.full_page});
        routeReport.screenshot={path:path.basename(shot),sha256:fileHash(shot)};
        const domBase=path.join(output,route.name+'.dom.json'),dom= gzipEvidence?domBase+'.gz':domBase;
        const domBytes=Buffer.from(JSON.stringify({url,theme:route.theme||null,viewport:route.viewport,analysis:checks,focus:routeReport.focus,temporal:routeReport.temporal},null,2)+'\n');
        fs.writeFileSync(dom,gzipEvidence?gzipSync(domBytes,{level:9}):domBytes);
        routeReport.dom={path:path.basename(dom),sha256:fileHash(dom)};
        routeReport.console_errors=consoleErrors; routeReport.page_errors=pageErrors;
        routeReport.status=classifyRouteStatus(routeReport.findings);
      } catch (e) {
        routeReport.status=e.status||'BLOCKED';routeReport.findings.push({code:'ROUTE_EXECUTION_ERROR',message:String(e).slice(0,400),reproduction:'See route and action sequence in the request.'});
        if (page) { try { const shot=path.join(output,route.name+'.failure.png'); await page.screenshot({path:shot,fullPage:false,timeout:3000}); routeReport.screenshot={path:path.basename(shot),sha256:fileHash(shot),captured_on_failure:true}; } catch {} }
      }
      finally { await context.close(); }
      report.routes.push(routeReport);
    }
  } finally { await browser.close(); }
  const required=VISUAL_CHECK_NAMES;
  const checkCoverage=Object.fromEntries(required.map(key=>[key,report.routes.map(route=>({route:route.name,status:route.check_coverage?.[key]||'NOT_RUN'}))]));
  report.check_coverage=checkCoverage;
  const covered = status => status==='EXECUTED'||status.startsWith('NOT_APPLICABLE_');
  report.unconfigured=required.filter(key=>!checkCoverage[key].some(x=>covered(x.status)));
  const missingRequired=[];
  for(const route of report.routes)for(const gate of route.required_checks||[])if(!covered(route.check_coverage?.[gate]||'NOT_RUN'))missingRequired.push({route:route.name,gate,status:route.check_coverage?.[gate]||'NOT_RUN'});
  const missingRequiredChecks=missingRequired.map(x=>`${x.route}:${x.gate}`);
  const statuses=report.routes.map(r=>r.status);
  if (statuses.includes('BLOCKED')) report.status='BLOCKED';
  else if (statuses.includes('FAIL')) report.status='FAIL';
  else if (statuses.includes('UNKNOWN')) report.status='UNKNOWN';
  else if (missingRequiredChecks.length) report.status='BLOCKED';
  else report.status='PASS';
  report.hard_gate_scope={declared_routes:spec.routes.map(r=>({name:r.name,path:r.path,theme:r.theme||null,viewport:r.viewport,state_contract:r.state_contract||null})),unconfigured_checks:report.unconfigured,missing_required_checks:missingRequiredChecks,missing_required_check_details:missingRequired,manual_aesthetic_review:'NOT_RUN',assistive_technology_qualification:'NOT_RUN',collector_authentication:'NOT_PROVEN',promotion:'NOT_APPROVED'};
  const out=path.join(output,'report.json');
  if(gzipEvidence){
    const fullPath=path.join(output,'report.json.gz');
    fs.writeFileSync(fullPath,gzipSync(Buffer.from(JSON.stringify(report,null,2)+'\n'),{level:9}));
    const findingSummary=items=>{const counts={};for(const item of items){const key=item.code||'UNKNOWN_CODE';counts[key]=(counts[key]||0)+1;}return counts;};
    const index={schema:report.schema,checker_version:report.checker_version,created_utc:report.created_utc,status:report.status,scope:report.scope,request_sha256:report.request_sha256,source_binding:report.source_binding,check_coverage:report.check_coverage,unconfigured:report.unconfigured,hard_gate_scope:report.hard_gate_scope,full_report:{path:path.basename(fullPath),sha256:fileHash(fullPath)},routes:report.routes.map(r=>({name:r.name,path:r.path,theme:r.theme,viewport:r.viewport,state_contract:r.state_contract,effective_policy_sha256:r.effective_policy_sha256,check_coverage:r.check_coverage,required_checks:r.required_checks,status:r.status,finding_counts:findingSummary(r.findings),screenshot:r.screenshot,dom:r.dom,actions:r.actions,focus:r.focus,temporal:r.temporal,console_errors:r.console_errors,page_errors:r.page_errors}))};
    fs.writeFileSync(out,JSON.stringify(index,null,2)+'\n');
  } else fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
  process.stdout.write(JSON.stringify({status:report.status,report:out,full_report:gzipEvidence?path.join(output,'report.json.gz'):out,routes:report.routes.map(r=>({name:r.name,status:r.status,findings:r.findings.length})),unconfigured:report.unconfigured})+'\n');
  process.exitCode=report.status==='PASS'?0:report.status==='FAIL'?3:report.status==='UNKNOWN'?4:5;
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(e=>{process.stderr.write(JSON.stringify({status:e.status||'BLOCKED',error:String(e.message||e)})+'\n');process.exitCode=e.status==='FAIL'?3:5;});
}
