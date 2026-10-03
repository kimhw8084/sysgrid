import { useState, useEffect } from 'react'

export interface SysError {
  id: string
  timestamp: string
  message: string
  stack?: string
  url?: string
  method?: string
  status?: number
  statusText?: string
  contentType?: string
  finalUrl?: string
  redirected?: boolean
  requestId?: string
  rawBody?: string
  browserOrigin?: string
  configuredApiBase?: string
  browserOnline?: boolean | null
  data?: any
  type: 'frontend' | 'backend'
  severity: 'critical' | 'error' | 'warning'
  view?: string
  acknowledged?: boolean
}

function storedError(error: SysError): SysError {
  const type = error.type === 'backend' ? 'backend' : 'frontend'
  const status = Number.isInteger(error.status) && error.status! >= 0 && error.status! <= 599 ? error.status : undefined
  return {
    id: typeof error.id === 'string' && /^[a-z0-9_-]{1,80}$/i.test(error.id) ? error.id : Math.random().toString(36).substring(2, 9),
    timestamp: typeof error.timestamp === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(error.timestamp) ? error.timestamp : new Date().toISOString(),
    type,
    severity: error.severity === 'critical' || error.severity === 'warning' ? error.severity : 'error',
    acknowledged: error.acknowledged === true,
    status,
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(error.method || '') ? error.method : undefined,
    requestId: typeof error.requestId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(error.requestId) ? error.requestId : undefined,
    message: `${type === 'backend' ? 'API' : 'Frontend'} error${status ? ` (${status})` : ''}. Detailed diagnostics were available in the original page session.`,
  }
}

class ErrorManager {
  private errors: SysError[] = []
  private listeners: ((errors: SysError[]) => void)[] = []
  private openListeners: ((isOpen: boolean) => void)[] = []
  private isOpen = false
  private readonly STORAGE_KEY = 'SYSGRID_ERROR_LOGS'

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('open-error-console', () => this.setOpen(true));
      this.loadFromStorage();
    }
  }

  private loadFromStorage() {
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved)
        this.errors = Array.isArray(parsed) ? parsed.filter(item => item && typeof item === 'object').slice(0, 100).map(storedError) : [];
        // Rewrite legacy records without retaining arbitrary message, response,
        // stack, URL or input data. Keep event identity and acknowledgement.
        this.saveToStorage();
        this.notify();
      }
    } catch (e) {
      console.warn("Failed to load error logs from storage.");
      this.errors = [];
      this.saveToStorage();
    }
  }

  private saveToStorage() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.errors.map(storedError)));
    } catch (e) {
      console.warn("Failed to save error logs to storage.");
    }
  }

  addError(error: Omit<SysError, 'id' | 'timestamp' | 'acknowledged'>) {
    const newError: SysError = {
      ...error,
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString(),
      acknowledged: false,
      view: window.location.pathname
    }
    this.errors = [newError, ...this.errors].slice(0, 100)
    this.saveToStorage()
    this.notify()
  }

  acknowledgeError(id: string) {
    this.errors = this.errors.map(e => e.id === id ? { ...e, acknowledged: true } : e)
    this.saveToStorage()
    this.notify()
  }

  acknowledgeAll() {
    this.errors = this.errors.map(e => ({ ...e, acknowledged: true }))
    this.saveToStorage()
    this.notify()
  }

  getErrors() {
    return this.errors
  }

  clearErrors() {
    this.errors = []
    this.saveToStorage()
    this.notify()
  }

  setOpen(open: boolean) {
    this.isOpen = open
    this.openListeners.forEach(l => l(this.isOpen))
  }

  getIsOpen() {
    return this.isOpen
  }

  subscribe(listener: (errors: SysError[]) => void) {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener)
    }
  }

  subscribeOpen(listener: (isOpen: boolean) => void) {
    this.openListeners.push(listener)
    return () => {
      this.openListeners = this.openListeners.filter(l => l !== listener)
    }
  }

  private notify() {
    this.listeners.forEach(l => l(this.errors))
  }
}

export const errorManager = new ErrorManager()

export function useErrors() {
  const [errors, setErrors] = useState<SysError[]>(errorManager.getErrors())
  const [isOpen, setIsOpen] = useState<boolean>(errorManager.getIsOpen())

  useEffect(() => {
    const unsubErrors = errorManager.subscribe(setErrors)
    const unsubOpen = errorManager.subscribeOpen(setIsOpen)
    return () => {
      unsubErrors()
      unsubOpen()
    }
  }, [])

  return { 
    errors, 
    isOpen, 
    setOpen: (v: boolean) => errorManager.setOpen(v), 
    clearErrors: () => errorManager.clearErrors(),
    acknowledgeError: (id: string) => errorManager.acknowledgeError(id),
    acknowledgeAll: () => errorManager.acknowledgeAll()
  }
}
