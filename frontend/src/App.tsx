// SYSGRID_VISUAL_REPAIR_R4
// SYSGRID_VISUAL_REPAIR_R3
// SYSGRID_VISUAL_REPAIR_V1
import { useProjectsNavigation, ProjectsNavigationButton, ProjectsNavigationBackdrop } from './components/ProjectsWorkspaceLayout'
import React, { useState, useEffect, useRef, Component, ErrorInfo, ReactNode } from "react"
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query"
import { Routes, Route, Link, useLocation, useNavigate, Navigate, RouterProvider, createBrowserRouter } from "react-router-dom"
import { motion, AnimatePresence } from "framer-motion"
import { Terminal, X, ChevronRight, Info, Star, RefreshCcw, Grid3X3, Clock, Globe, Search } from "lucide-react"
import { Toaster, toast } from "react-hot-toast"
import { apiFetch, subscribeToLatency, getConfig, getRequestScopeKey } from "./api/apiClient"
import { errorManager, useErrors } from "./stores/errorStore"
import { ErrorConsole } from "./components/shared/ErrorConsole"

import Dashboard from "./components/Dashboard"
import AssetGrid_Legacy from "./components/AssetGrid_Legacy"
import Assets from "./components/Assets"
import Intelligence from "./components/Intelligence"
import AuditLogs from "./components/AuditLogs"
import ServicesReal from "./components/ServicesReal"
import SettingsPage from "./components/Settings"
import Maintenance from "./components/Maintenance"
import MonitoringGrid from "./components/MonitoringGrid"
import Research from "./components/Research"
import NetworkReal from "./components/NetworkReal"
import VendorsReal from "./components/VendorsReal"
import Knowledge from "./components/Knowledge"
import FAR from "./components/FAR"
import ArchitectureWorkspace from "./components/ArchitectureWorkspace"
import DataFlowDesigner from "./components/DataFlowDesigner"
import Projects from "./components/ProjectsSchedulingCompletion"
import External from "./components/External"
import Temp1 from "./components/Temp1"
import Racks from "./components/Racks"
import metadata from "./metadata.json"
import { GlobalSearch } from "./components/shared/GlobalSearch"
import { ShellHeader, ToolbarButton } from "./components/shared/LayoutPrimitives"
import { ShellHeaderTools } from "./components/shared/ShellHeaderTools"
import { FatalErrorState, PermissionDeniedState } from "./components/shared/ShellStates"
import { SHELL_NAV_GROUPS, ShellNavGroup, ShellNavItem, isShellRouteActive } from "./components/shared/ShellNavigation"
import { normalizeTheme } from "./components/shared/theme"
import { useRouteFocus } from "./components/shared/routeFocus"
import { ModulePolicyGate, useModulePolicy } from './policy/ModulePolicy'

const APP_VERSION = metadata.version
const PATCH_HISTORY = metadata.patchHistory

function ArchitectureRoute() {
  const location = useLocation()
  const legacy = new URLSearchParams(location.search).get('legacy') === 'true'
  return legacy ? <DataFlowDesigner /> : <ArchitectureWorkspace />
}

import { QueryCache, MutationCache } from "@tanstack/react-query"

import { showWorkspaceToast } from "./components/shared/WorkspaceToast"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000, // 30 seconds
      gcTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      // Do not let React Query pause and replay unreviewed PV1 writes after a
      // reconnect. apiFetch reports the offline write without sending it.
      networkMode: 'always',
    },
  },
  queryCache: new QueryCache({
    onError: (error: any) => {
      if (error?.silent === true) return;
      // Avoid spamming error store if it's a connection error we're already retrying
      if (error.status === 0 || error.message === 'Failed to fetch') {
        console.warn("Connection lost, suppressing global error toast to prevent loop");
        return;
      }
      errorManager.addError({
        message: error.message || 'API Query Failure',
        stack: error.traceback || error.stack,
        status: error.status,
        statusText: error.statusText,
        contentType: error.contentType,
        finalUrl: error.finalUrl,
        redirected: error.redirected,
        requestId: error.requestId,
        rawBody: error.rawBody,
        browserOrigin: error.browserOrigin,
        configuredApiBase: error.configuredApiBase,
        browserOnline: error.browserOnline,
        url: error.url,
        method: error.method,
        data: error.data,
        type: 'backend',
        severity: 'error'
      });
      showWorkspaceToast(error.message || 'API Query Failure', { type: 'error' });
    }
  }),
  mutationCache: new MutationCache({
    onError: (error: any) => {
      if (error?.silent === true) return;
      errorManager.addError({
        message: error.message || 'API Mutation Failure',
        stack: error.traceback || error.stack,
        status: error.status,
        statusText: error.statusText,
        contentType: error.contentType,
        finalUrl: error.finalUrl,
        redirected: error.redirected,
        requestId: error.requestId,
        rawBody: error.rawBody,
        browserOrigin: error.browserOrigin,
        configuredApiBase: error.configuredApiBase,
        browserOnline: error.browserOnline,
        url: error.url,
        method: error.method,
        data: error.data,
        type: 'backend',
        severity: 'error'
      });
      showWorkspaceToast(error.message || 'API Mutation Failure', { type: 'error' });
    }
  })
})

const appRouter = createBrowserRouter([
  {
    path: '*',
    element: <MainLayout />,
  },
])

class ErrorBoundary extends Component<{children: ReactNode}, {hasError: boolean, error: any}> {
  constructor(props: any) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error: any) { return { hasError: true, error }; }
  componentDidCatch(error: any, info: ErrorInfo) {
    console.error("CRASH:", error, info);
    errorManager.addError({
      message: error?.message || 'The view could not be rendered',
      stack: error?.stack,
      data: { componentStack: info.componentStack },
      type: 'frontend',
      severity: 'critical',
    });
  }
  render() {
    return this.state.hasError
      ? <FatalErrorState error={this.state.error} />
      : this.props.children;
  }
}

const LegacyNetworkRedirect = () => {
  const location = useLocation()
  return <Navigate to={`/network${location.search || ''}`} replace />
}

const LegacyAssetRedirect = () => {
  const location = useLocation()
  return <Navigate to={`/asset${location.search || ''}`} replace />
}

function useModalFocus() {
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previousFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0)

    return () => {
      window.clearTimeout(focusTimer)
      previousFocusedElement?.focus()
    }
  }, [])

  return closeButtonRef
}

const PatchNotesModal = ({ onClose }: any) => {
  const [expandedIndex, setExpandedIndex] = useState(0)
  const closeButtonRef = useModalFocus()
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="patch-notes-title">
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="glass-panel w-[600px] max-h-[80vh] overflow-hidden flex flex-col p-10 rounded-lg border-blue-500/30">
         <div className="flex items-center justify-between border-b border-white/10 pb-6">
            <div className="flex items-center space-x-4">
               <Star size={24} className="text-blue-400 animate-pulse" />
               <h2 id="patch-notes-title" className="text-2xl font-black uppercase text-white">Registry Updates</h2>
            </div>
            <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close patch notes" className="text-slate-500 hover:text-white transition-colors"><X size={24} aria-hidden="true" /></button>
         </div>
         <div className="flex-1 overflow-y-auto custom-scrollbar mt-6 space-y-4">
            {PATCH_HISTORY.map((patch, idx) => (
              <div key={patch.version} className={`border border-white/5 rounded-lg overflow-hidden ${expandedIndex === idx ? "bg-white/5 border-blue-500/20" : "hover:bg-white/5"}`}>
                 <button onClick={() => setExpandedIndex(expandedIndex === idx ? -1 : idx)} className="w-full px-6 py-4 flex items-center justify-between text-left">
                    <div>
                       <span className={`text-[10px] font-black uppercase tracking-widest ${expandedIndex === idx ? "text-blue-400" : "text-slate-500"}`}>{patch.version}</span>
                       <p className="text-[8px] font-bold text-slate-600 uppercase mt-0.5">{patch.date}</p>
                    </div>
                    <ChevronRight size={16} className={`text-slate-500 transition-transform ${expandedIndex === idx ? "rotate-90" : ""}`} />
                 </button>
                 <AnimatePresence>
                    {expandedIndex === idx && (
                      <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
                         <div className="px-6 pb-6 pt-2 space-y-3">
                            {patch.changes.map((change, cIdx) => (
                              <div key={cIdx} className="flex space-x-3 text-[11px] font-bold uppercase tracking-tight">
                                 <span className={`text-[8px] px-1.5 py-0.5 rounded-lg h-fit ${change.type === 'New' ? 'bg-emerald-500/20 text-emerald-400' : change.type === 'Fixed' ? 'bg-blue-500/20 text-blue-400' : 'bg-amber-500/20 text-amber-400'}`}>{change.type}</span>
                                 <span className="text-slate-300 leading-tight">{change.text}</span>
                              </div>
                            ))}
                         </div>
                      </motion.div>
                    )}
                 </AnimatePresence>
              </div>
            ))}
         </div>
         <button type="button" onClick={onClose} className="w-full mt-8 py-4 bg-blue-600 text-white rounded-lg font-black uppercase shadow-lg shadow-blue-500/20">Close patch notes</button>
      </motion.div>
    </div>
  )
}

const LinuxEnvModal = ({ onClose }: any) => {
  const closeButtonRef = useModalFocus()
  const { data: envVars, isLoading } = useQuery({
    queryKey: ['linux-env-vars'],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/settings/user/env-vars");
      return res.json();
    }
  });

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-10" role="dialog" aria-modal="true" aria-labelledby="environment-details-title">
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="glass-panel w-[700px] max-h-[80vh] flex flex-col p-10 rounded-lg border border-blue-500/30 overflow-hidden shadow-2xl">
         <div className="flex items-center justify-between border-b border-white/5 pb-6">
            <div className="flex items-center space-x-4">
               <div className="p-3 bg-blue-600 text-white rounded-lg shadow-lg shadow-blue-500/20"><Terminal size={24} /></div>
               <div>
                  <h2 id="environment-details-title" className="text-2xl font-black uppercase text-white tracking-tighter leading-none">Environment details</h2>
                  <p className="text-[10px] text-slate-500 uppercase font-black tracking-[0.2em] mt-2">Current operating system parameters</p>
               </div>
            </div>
            <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close environment details" className="text-slate-500 hover:text-white transition-colors p-2 hover:bg-white/5 rounded-lg"><X size={24} aria-hidden="true" /></button>
         </div>

         <div className="flex-1 overflow-y-auto custom-scrollbar mt-6 space-y-4 pr-2">
            {isLoading ? (
               <div className="flex flex-col items-center justify-center py-20 text-blue-400 space-y-4">
                  <RefreshCcw size={32} className="animate-spin" />
                  <p className="text-[10px] font-black uppercase tracking-widest">Loading environment values...</p>
               </div>
            ) : envVars ? (
               <div className="grid grid-cols-1 gap-2">
                  {Object.entries(envVars).map(([key, value]: [string, any]) => (
                     <div key={key} className="flex items-center justify-between p-3 bg-white/[0.03] border border-white/5 rounded-lg hover:border-blue-500/20 transition-all group">
                        <span className="text-[9px] font-black uppercase text-slate-500 tracking-wider group-hover:text-blue-400 transition-colors">{key}</span>
                        <span className="text-[10px] font-mono text-slate-300 font-bold truncate max-w-[400px] bg-black/40 px-3 py-1 rounded-lg border border-white/5" title={String(value)}>{String(value)}</span>
                     </div>
                  ))}
               </div>
            ) : null}
         </div>
         
         <div className="mt-8 p-4 bg-amber-500/5 border border-amber-500/10 rounded-lg flex items-start gap-4">
            <Info size={18} className="text-amber-500 shrink-0" />
            <p className="text-[9px] font-bold text-amber-500/80 uppercase leading-relaxed tracking-tight">
               These variables are extracted directly from the underlying Linux OS execution context. They impact how the SysGrid Engine interacts with system binaries and file-system hooks.
            </p>
         </div>

         <button onClick={onClose} className="w-full mt-8 py-4 bg-blue-600 text-white rounded-lg font-black uppercase shadow-lg shadow-blue-500/20 active:scale-95 transition-all">Close Diagnostic View</button>
      </motion.div>
    </div>
  )
}

function MainLayout() {
  const location = useLocation(); 
  const navigate = useNavigate(); 
  const mainContentRef = useRef<HTMLDivElement>(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 1024);
  const projectNavigation = useProjectsNavigation(location.pathname, isSidebarOpen, setIsSidebarOpen); 
  const [showPatchNotes, setShowPatchNotes] = useState(false);
  const [showLinuxEnv, setShowLinuxEnv] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [currentTheme, setCurrentTheme] = useState(normalizeTheme(localStorage.getItem('sysgrid-theme')));
  const [latency, setLatency] = useState(0);
  const [currentTime, setCurrentTime] = useState(new Date());
  const modulePolicy = useModulePolicy()

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useRouteFocus(location, mainContentRef)

  const formatTime = (date: Date, timeZone: string) => {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(date);
  };

  useEffect(() => {
    document.title = getConfig('VITE_APP_TITLE', 'SYSGRID INFRASTRUCTURE');
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const { data: userProfile } = useQuery({
    queryKey: ['user-profile'],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/settings/user/profile");
      const data = await res.json();
      if (data?.username) {
        localStorage.setItem('SYSGRID_USER_ID', data.username);
      }
      return data;
    }
  });

  const { data: userSettings } = useQuery({
    queryKey: ['user-settings'],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/settings/user/settings");
      return res.json();
    }
  });

  useEffect(() => {
    if (userSettings?.theme) {
      const normalizedTheme = normalizeTheme(userSettings.theme);
      setCurrentTheme(normalizedTheme);
      document.documentElement.setAttribute('data-theme', normalizedTheme);
      const isLight = normalizedTheme === 'pure-clarity';
      if (isLight) document.documentElement.classList.remove('dark');
      else document.documentElement.classList.add('dark');
    }
  }, [userSettings]);

  useEffect(() => {
    return subscribeToLatency(setLatency);
  }, []);

  const THEMES = [
    { id: 'nordic-frost-v1', label: 'Dark Mode', color: 'bg-[#1a1b26]' },
    { id: 'pure-clarity', label: 'Light Mode', color: 'bg-[#ffffff]' }
  ]

  const changeTheme = (themeId: string) => {
    const normalizedTheme = normalizeTheme(themeId);
    setCurrentTheme(normalizedTheme);
    document.documentElement.setAttribute('data-theme', normalizedTheme);
    
    // Explicitly handle light/dark class for Tailwind and global styles
    const isLight = normalizedTheme === 'pure-clarity';
    if (isLight) {
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
    }
    
    localStorage.setItem('sysgrid-theme', normalizedTheme);
    toast.success(`Theme changed to ${THEMES.find(t => t.id === normalizedTheme)?.label}`);
    
    // Attempt to sync with backend if possible
    apiFetch("/api/v1/settings/user/settings", {
      method: "PATCH",
      body: JSON.stringify({ theme: normalizedTheme })
    }).catch(() => {});
  }

  const { data: healthData, isLoading: isHealthLoading, isError: isHealthError } = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const response = await apiFetch("/api/v1/health");
      return response.json();
    },
    refetchInterval: 10000,
    retry: 2,
    staleTime: 5000
  });

  const isOnline = !!healthData && !isHealthError;

  const { errors, setOpen: setErrorConsoleOpen } = useErrors();

  useEffect(() => {
    const handleRejection = (event: PromiseRejectionEvent) => {
      const error = event.reason;
      
      // If it's a backend error that already has traceback/status, it might have been caught by QueryCache already.
      // But we still want to log it if it wasn't caught elsewhere.
      if (error) {
        errorManager.addError({
          message: error.message || 'Unhandled Promise Rejection',
          stack: error.traceback || error.stack,
          status: error.status,
          data: error.data,
          type: error.status ? 'backend' : 'frontend',
          severity: 'error'
        });
        event.preventDefault();
      }
    };

    const handleWindowError = (event: ErrorEvent) => {
      errorManager.addError({
        message: event.message || 'Frontend Exception',
        stack: event.error?.stack,
        url: event.filename,
        type: 'frontend',
        severity: 'critical'
      });
    };

    window.addEventListener('unhandledrejection', handleRejection);
    window.addEventListener('error', handleWindowError);
    return () => {
      window.removeEventListener('unhandledrejection', handleRejection);
      window.removeEventListener('error', handleWindowError);
    };
  }, []);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Detect Ctrl+C or Cmd+C
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        const activeElement = document.activeElement as HTMLElement;
        
        // Check if the focused element is an AgGrid cell
        if (activeElement && activeElement.classList.contains('ag-cell')) {
          // If there is no active text selection by the user, we copy the cell content
          const selection = window.getSelection();
          if (!selection || selection.toString() === '') {
            const textToCopy = activeElement.innerText;
            if (textToCopy) {
              navigator.clipboard.writeText(textToCopy).then(() => {
                toast.success("Cell content copied", { 
                  id: 'ag-grid-copy-toast', 
                  duration: 800,
                  style: {
                    background: '#1e293b',
                    color: '#3b82f6',
                    fontSize: '10px',
                    fontWeight: '900',
                    textTransform: 'uppercase',
                    border: '1px solid rgba(59, 130, 246, 0.2)'
                  }
                });
              }).catch(() => {});
            }
          }
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  useEffect(() => { 
    document.documentElement.setAttribute('data-theme', currentTheme);
    const isLight = currentTheme === 'pure-clarity';
    if (isLight) document.documentElement.classList.remove('dark');
    else document.documentElement.classList.add('dark');
  }, [currentTheme])

  return (
    <div className="sg-app-shell flex h-screen overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)] font-sans" data-sg-projects-app={projectNavigation.active ? "true" : undefined}>
      <Toaster position="top-right" toastOptions={{ duration: 4000 }} />
      <ProjectsNavigationBackdrop nav={projectNavigation} />
      <a href="#sg-main-content" className="skip-link">Skip to content</a>
      <motion.aside
        initial={projectNavigation.active ? false : undefined}
        transition={projectNavigation.active ? { duration: 0 } : undefined}
        animate={{ width: projectNavigation.active ? (projectNavigation.sidebarExpanded ? 240 : 80) : (isSidebarOpen ? 240 : 80) }}
        className="glass-panel relative z-20 flex shrink-0 flex-col border-r border-[var(--border-default)] bg-[var(--sidebar-bg)] shadow-xl"
        aria-label="Application navigation"
        data-sg-app-sidebar="true"
        data-sg-nav-open={projectNavigation.sidebarExpanded ? "true" : "false"}
      >
        <div className={`flex items-center border-b border-[var(--border-subtle)] p-4 ${isSidebarOpen ? 'justify-between' : 'justify-center'}`}>
          <Link to="/" className="group flex min-w-0 items-center gap-3 rounded-md focus-visible:outline-none" aria-label="SysGrid home">
             <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/5 bg-[var(--action-primary)] shadow-lg transition-transform group-hover:scale-105">
                <Grid3X3 size={20} aria-hidden="true" className="text-white" />
             </div>
             {isSidebarOpen && <span className="truncate text-lg font-semibold tracking-tight text-[var(--text-primary)]">SYSGRID</span>}
          </Link>
          {isSidebarOpen ? (
            <button
              type="button"
              onClick={() => projectNavigation.mobile ? projectNavigation.close() : setIsSidebarOpen(false)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
              aria-label={projectNavigation.mobile ? 'Close application navigation' : 'Collapse application navigation'}
              aria-expanded="true"
              title={projectNavigation.mobile ? 'Close navigation' : 'Collapse navigation'}
            >
              <span aria-hidden="true">‹</span>
            </button>
          ) : null}
        </div>
        {!isSidebarOpen && (
          <div className="flex justify-center border-b border-[var(--border-subtle)] py-2">
            <button
              type="button"
              onClick={() => setIsSidebarOpen(true)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
              aria-label="Expand application navigation"
              aria-expanded="false"
              title="Expand navigation"
            >
              <span aria-hidden="true">›</span>
            </button>
          </div>
        )}
        <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4 custom-scrollbar" aria-label="Primary navigation">
          {SHELL_NAV_GROUPS.map((group) => (
            <ShellNavGroup key={group.label} label={group.label} isSidebarOpen={isSidebarOpen} defaultExpanded={group.defaultExpanded}>
              {group.items.map((item) => {
                const module = modulePolicy.data?.modules?.[item.moduleId]
                return (
                  <ShellNavItem
                    key={item.path}
                    icon={item.icon}
                    moduleId={item.moduleId}
                    label={module?.label || item.label}
                    path={item.path}
                    active={isShellRouteActive(location.pathname, item.path, item.aliases)}
                    isOpen={isSidebarOpen}
                    unavailableReason={module?.blocked_reason}
                  />
                )
              })}
            </ShellNavGroup>
          ))}
        </nav>
        
        {/* User Profile Section */}
        <div className={`space-y-2 border-t border-[var(--border-subtle)] p-3 ${!isSidebarOpen ? 'flex flex-col items-center' : ''}`}>
           {modulePolicy.data?.actions?.diagnostics?.read ? <button
              onClick={() => setShowLinuxEnv(true)}
              className={`flex items-center gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-2 hover:bg-[var(--surface-hover)] ${!isSidebarOpen ? 'h-10 w-10 justify-center' : 'w-full text-left'}`}
              aria-label="Open environment details"
           >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[var(--surface-hover)] text-[var(--accent-primary)]">
                 <Globe size={16} aria-hidden="true" />
              </div>
              {isSidebarOpen && (
                <div className="flex flex-col min-w-0">
                   <span className="truncate text-xs font-medium text-[var(--text-primary)]">{userProfile?.full_name || userProfile?.username || 'Operator'}</span>
                   <span className="truncate text-[10px] text-[var(--text-muted)]">{userProfile?.username || 'Signed-in user'}</span>
                </div>
              )}
           </button> : null}

           {/* Direct Theme Toggles */}
           <div className={`flex items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-1 ${!isSidebarOpen ? 'flex-col' : 'w-full'}`} aria-label="Theme">
              {THEMES.map(theme => (
                <button 
                  key={theme.id}
                  onClick={() => changeTheme(theme.id)}
                  type="button"
                  className={`flex min-h-9 flex-1 items-center gap-2 rounded-md p-2 text-xs transition-colors ${currentTheme === theme.id ? 'border border-[var(--action-primary)] bg-[var(--action-primary-muted)] text-[var(--action-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]'} ${!isSidebarOpen ? 'w-full justify-center' : ''}`}
                  title={theme.label}
                  aria-label={isSidebarOpen ? undefined : `Use ${theme.label}`}
                  aria-pressed={currentTheme === theme.id}
                >
                   <div className={`w-3 h-3 rounded-full ${theme.color} border border-white/10 shrink-0`} />
                   {isSidebarOpen && <span className="text-[9px] font-black uppercase tracking-widest">{theme.label.split(' ')[0]}</span>}
                </button>
              ))}
           </div>
        </div>

        <div className="border-t border-[var(--border-subtle)] p-3 text-center">
           {isSidebarOpen ? <p className="text-[10px] text-[var(--text-muted)]">Version {APP_VERSION}</p> : <span className="sr-only">Version {APP_VERSION}</span>}
        </div>
      </motion.aside>
      <main className="flex-1 flex flex-col overflow-hidden relative" data-sg-app-main="true">
        <ShellHeader
          left={
            <><ProjectsNavigationButton nav={projectNavigation} />{<>
              <ToolbarButton onClick={() => setShowPatchNotes(true)}>Patch Notes</ToolbarButton>
              <button
                onClick={() => setIsSearchOpen(true)}
                className="group flex min-w-0 max-w-full flex-1 items-center gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2 text-[var(--text-secondary)] transition-colors hover:border-[var(--action-primary)] hover:text-[var(--text-primary)] md:min-w-[320px]" data-sg-app-search="true" aria-label="Search released and authorized records"
              >
                <Search size={16} aria-hidden="true" className="shrink-0 transition-colors group-hover:text-[var(--accent-primary)]" />
                <span className="min-w-0 flex-1 truncate text-left text-sm">Search released and authorized records...</span>
                <div className="hidden items-center gap-1 opacity-60 transition-opacity group-hover:opacity-100 sm:flex">
                  <span className="rounded border border-[var(--border-subtle)] bg-[var(--surface-base)] px-1.5 py-0.5 text-[10px]">⌘</span>
                  <span className="rounded border border-[var(--border-subtle)] bg-[var(--surface-base)] px-1.5 py-0.5 text-[10px]">K</span>
                </div>
              </button>
            </>}</>
          }
          right={<ShellHeaderTools
            pathname={location.pathname}
            isOnline={isOnline}
            isHealthLoading={isHealthLoading}
            isHealthError={isHealthError}
            latency={latency}
            errors={errors}
            onOpenErrorConsole={() => setErrorConsoleOpen(true)}
            compact={projectNavigation.active}
          />}
        />

        <div ref={mainContentRef} id="sg-main-content" tabIndex={-1} className={`relative flex min-h-0 flex-1 flex-col overflow-hidden focus-visible:outline-none ${location.pathname === '/architecture' || location.pathname === '/logs' || location.pathname === '/projects' ? '' : 'p-4 sm:p-8'}`} data-sg-content-panel="true">
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Dashboard onNavigate={(p:any) => navigate("/" + p)} />} />
              <Route path="/projects/*" element={<ModulePolicyGate moduleId="projects"><Projects /></ModulePolicyGate>} />
              <Route path="/racks" element={<ModulePolicyGate moduleId="racks"><Racks /></ModulePolicyGate>} />
              <Route path="/asset" element={<ModulePolicyGate moduleId="assets"><Assets /></ModulePolicyGate>} />
              <Route path="/asset-real" element={<ModulePolicyGate moduleId="assets"><LegacyAssetRedirect /></ModulePolicyGate>} />
              <Route path="/services" element={<ModulePolicyGate moduleId="services"><ServicesReal /></ModulePolicyGate>} />
              <Route path="/external" element={<ModulePolicyGate moduleId="external"><External /></ModulePolicyGate>} />
              <Route path="/network" element={<ModulePolicyGate moduleId="network"><NetworkReal /></ModulePolicyGate>} />
              <Route path="/network-real" element={<ModulePolicyGate moduleId="network"><LegacyNetworkRedirect /></ModulePolicyGate>} />
              <Route path="/architecture" element={<ModulePolicyGate moduleId="architecture"><ArchitectureRoute /></ModulePolicyGate>} />
              <Route path="/research" element={<ModulePolicyGate moduleId="research"><Research /></ModulePolicyGate>} />
              <Route path="/far" element={<ModulePolicyGate moduleId="far"><FAR /></ModulePolicyGate>} />
              <Route path="/monitoring" element={<ModulePolicyGate moduleId="monitoring"><MonitoringGrid /></ModulePolicyGate>} />
              <Route path="/vendors" element={<ModulePolicyGate moduleId="vendors"><VendorsReal /></ModulePolicyGate>} />
              <Route path="/vendors-real" element={<ModulePolicyGate moduleId="vendors"><VendorsReal /></ModulePolicyGate>} />
              <Route path="/knowledge" element={<ModulePolicyGate moduleId="knowledge"><Knowledge /></ModulePolicyGate>} />
              <Route path="/logs" element={<ModulePolicyGate moduleId="logs"><AuditLogs /></ModulePolicyGate>} />
              <Route path="/settings" element={<ModulePolicyGate moduleId="settings"><SettingsPage /></ModulePolicyGate>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ErrorBoundary>
        </div>
        <footer className="min-h-8 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-[var(--border-subtle)] bg-[var(--bg-primary)]/20 px-4 py-2 text-[10px] text-[var(--text-muted)] sm:px-8">
           <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                 <Globe size={10} aria-hidden="true" className="text-[var(--text-muted)]" />
                 <span>YOUR TIME ({Intl.DateTimeFormat().resolvedOptions().timeZone}): <span className="text-blue-400 tabular-nums">{formatTime(currentTime, Intl.DateTimeFormat().resolvedOptions().timeZone)}</span></span>
              </div>
              <div className="flex items-center gap-2 border-l border-white/5 pl-6">
                 <Clock size={10} aria-hidden="true" className="text-[var(--text-muted)]" />
                 <span>SOUTH KOREA (KST): <span className="text-[var(--text-primary)] tabular-nums">{formatTime(currentTime, 'Asia/Seoul')}</span></span>
              </div>
           </div>
           <span className="text-[var(--accent-primary)]">Version {APP_VERSION}</span>
        </footer>
      </main>
      <AnimatePresence>
        {showPatchNotes && <PatchNotesModal onClose={() => setShowPatchNotes(false)} />}
        {showLinuxEnv && <LinuxEnvModal onClose={() => setShowLinuxEnv(false)} />}
        {isSearchOpen && <GlobalSearch isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />}
        <ErrorConsole />
      </AnimatePresence>
    </div>
  )
}

import { ErrorSentinel } from './components/shared/ErrorSentinel'

function ReconnectRefresh() {
  React.useEffect(() => {
    const refresh = () => { void queryClient.invalidateQueries() }
    const handleScopeChange = () => {
      // Protected query keys include the request scope; clear old results so a
      // tenant/user switch cannot render data from the previous identity.
      queryClient.clear()
      void queryClient.invalidateQueries({ queryKey: ['module-policy', getRequestScopeKey()] })
    }
    window.addEventListener('online', refresh)
    window.addEventListener('sysgrid-scope-changed', handleScopeChange)
    return () => {
      window.removeEventListener('online', refresh)
      window.removeEventListener('sysgrid-scope-changed', handleScopeChange)
    }
  }, [])
  return null
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ReconnectRefresh />
      <ErrorSentinel>
        <RouterProvider router={appRouter} />
      </ErrorSentinel>
    </QueryClientProvider>
  )
}
