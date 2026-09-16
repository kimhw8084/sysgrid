import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, X, Loader2, Server, Briefcase, AlertTriangle, ChevronRight, Activity, Layers, BookOpen, Network } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../api/apiClient';
import metadata from '../../metadata.json';

interface SearchResult {
  id: number;
  type: 'asset' | 'project' | 'far' | 'service' | 'monitoring' | 'knowledge' | 'network';
  title: string;
  subtitle: string;
  tag: string;
  path: string;
}

export const GlobalSearch = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusTimeout = window.setTimeout(() => inputRef.current?.focus(), 100)
    setQuery('');
    setResults([]);
    return () => {
      window.clearTimeout(focusTimeout)
      previousFocus?.focus()
    }
  }, [isOpen]);

  useEffect(() => {
    const handler = setTimeout(async () => {
      const trimmedQuery = query.trim();
      if (trimmedQuery.length >= 2) {
        setIsLoading(true);
        try {
          const res = await apiFetch(`/api/v1/dashboard/search?q=${encodeURIComponent(trimmedQuery)}`);
          const data = await res.json();
          setResults(data.results || []);
          setSelectedIndex(0);
        } catch (err) {
          console.error('Search failed:', err);
        } finally {
          setIsLoading(false);
        }
      } else {
        setResults([]);
      }
    }, 500); // Increased debounce for stability

    return () => clearTimeout(handler);
  }, [query]);

  const groupedResults = useMemo(() => {
    const groups: Record<string, SearchResult[]> = {};
    results.forEach(res => {
      if (!groups[res.type]) groups[res.type] = [];
      groups[res.type].push(res);
    });
    return groups;
  }, [results]);

  const flattenedResults = useMemo(() => {
    return Object.values(groupedResults).flat();
  }, [groupedResults]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (flattenedResults.length === 0) return;
    if (e.key === 'ArrowDown') {
      setSelectedIndex((prev) => (prev + 1) % flattenedResults.length);
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setSelectedIndex((prev) => (prev - 1 + flattenedResults.length) % flattenedResults.length);
      e.preventDefault();
    } else if (e.key === 'Enter' && flattenedResults[selectedIndex]) {
      handleSelect(flattenedResults[selectedIndex]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const handleSelect = (result: SearchResult) => {
    // Append ID to path if not present for highlighting
    const finalPath = result.path.includes('?') ? `${result.path}&id=${result.id}` : `${result.path}?id=${result.id}`;
    navigate(finalPath);
    onClose();
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'asset': return <Server size={14} className="text-blue-400" />;
      case 'project': return <Briefcase size={14} className="text-emerald-400" />;
      case 'far': return <AlertTriangle size={14} className="text-amber-400" />;
      case 'service': return <Layers size={14} className="text-fuchsia-400" />;
      case 'monitoring': return <Activity size={14} className="text-rose-400" />;
      case 'knowledge': return <BookOpen size={14} className="text-sky-400" />;
      case 'network': return <Network size={14} className="text-indigo-400" />;
      default: return <ChevronRight size={14} />;
    }
  };

  const getLabel = (type: string) => {
    switch (type) {
      case 'asset': return 'Infrastructure Nodes';
      case 'project': return 'Active Initiatives';
      case 'far': return 'Failure Mode Registry';
      case 'service': return 'Service Instances';
      case 'monitoring': return 'Monitoring Coverage';
      case 'knowledge': return 'Knowledge Base';
      case 'network': return 'Network Fabric';
      default: return 'Records';
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[15vh]" role="dialog" aria-modal="true" aria-labelledby="global-search-title">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            aria-hidden="true"
          />
          
          <motion.div
            initial={{ scale: 0.98, opacity: 0, y: -10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.98, opacity: 0, y: -10 }}
            onKeyDown={(event) => { if (event.key === 'Escape') handleKeyDown(event) }}
            className="relative z-10 w-full max-w-2xl overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--surface-overlay)] shadow-2xl backdrop-blur-xl"
          >
            <div className="flex items-center border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-5">
              <Search size={20} aria-hidden="true" className="mr-4 text-[var(--text-muted)]" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search Assets, Projects, FAR, Services, Monitoring..."
                aria-label="Search assets, projects, FAR, services, and monitoring"
                className="flex-1 border-none bg-transparent text-sm font-medium tracking-[0.02em] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
              />
              {isLoading ? (
                <Loader2 size={18} className="text-blue-500 animate-spin" />
              ) : (
                <button type="button" onClick={onClose} aria-label="Close search" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                  <X size={18} aria-hidden="true" />
                </button>
              )}
            </div>

            <div className="max-h-[60vh] overflow-y-auto custom-scrollbar p-2">
              {results.length > 0 ? (
                <div className="space-y-4">
                  {Object.entries(groupedResults).map(([type, items]) => (
                    <div key={type} className="space-y-1">
                      <div className="px-3 py-1 mb-2">
                        <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.3em]">{getLabel(type)}</span>
                      </div>
                      {items.map((result) => {
                        const globalIndex = flattenedResults.indexOf(result);
                        const isSelected = globalIndex === selectedIndex;
                        return (
                          <button
                            key={`${result.type}-${result.id}`}
                            onMouseEnter={() => setSelectedIndex(globalIndex)}
                            onClick={() => handleSelect(result)}
                            aria-pressed={isSelected}
                            className={`w-full flex items-center justify-between p-3.5 rounded-lg transition-all ${
                              isSelected ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'hover:bg-white/5 text-slate-300'
                            }`}
                          >
                            <div className="flex items-center gap-4">
                              <div className={`p-2 rounded-lg ${isSelected ? 'bg-white/20' : 'bg-white/5 border border-white/5'}`}>
                                {getIcon(result.type)}
                              </div>
                              <div className="text-left">
                                <p className="text-[11px] font-black tracking-tight leading-none mb-1">{result.title}</p>
                                <p className={`text-[9px] font-bold tracking-tight ${isSelected ? 'text-blue-100' : 'text-slate-500'}`}>
                                  {result.subtitle}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-lg border ${
                                isSelected ? 'bg-white/20 border-white/30 text-white' : 'bg-white/5 border-white/10 text-slate-500'
                              }`}>
                                {result.tag}
                              </span>
                              <ChevronRight size={14} className={isSelected ? 'text-white' : 'text-slate-700'} />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ) : query.length >= 2 && !isLoading ? (
                <div className="p-16 text-center">
                  <div className="w-12 h-12 bg-rose-500/10 rounded-lg flex items-center justify-center mx-auto mb-4 border border-rose-500/20">
                    <X size={20} className="text-rose-500" />
                  </div>
                  <p className="text-[10px] font-black text-slate-500 tracking-[0.08em]">Zero records found for "{query}"</p>
                </div>
              ) : (
                <div className="p-12 flex flex-col items-center gap-4 opacity-40">
                   <div className="w-14 h-14 bg-white/5 rounded-lg flex items-center justify-center border border-white/5">
                      <Search size={24} className="text-slate-500" />
                   </div>
                   <div className="text-center">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.3em]">Search index ready</p>
                      <p className="text-[8px] font-bold text-slate-600 uppercase tracking-widest mt-1">Enter at least 2 characters to search</p>
                   </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-white/5 bg-black/20 flex items-center justify-between">
               <div className="flex gap-6">
                  <div className="flex items-center gap-2">
                     <kbd className="px-1.5 py-0.5 bg-white/10 rounded-lg text-[9px] text-slate-400 font-mono font-bold border border-white/10">↑↓</kbd>
                     <span className="text-[8px] font-black text-slate-600 uppercase tracking-widest">Navigate</span>
                  </div>
                  <div className="flex items-center gap-2">
                     <kbd className="px-1.5 py-0.5 bg-white/10 rounded-lg text-[9px] text-slate-400 font-mono font-bold border border-white/10">ENTER</kbd>
                     <span className="text-[8px] font-black text-slate-600 uppercase tracking-widest">Open</span>
                  </div>
                  <div className="flex items-center gap-2">
                     <kbd className="px-1.5 py-0.5 bg-white/10 rounded-lg text-[9px] text-slate-400 font-mono font-bold border border-white/10">ESC</kbd>
                     <span className="text-[8px] font-black text-slate-600 uppercase tracking-widest">Close</span>
                  </div>
               </div>
               <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                  <p className="text-[8px] font-black text-slate-600 uppercase tracking-[0.2em]">SYSGRID GLOBAL SEARCH v{metadata.version}</p>
               </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
