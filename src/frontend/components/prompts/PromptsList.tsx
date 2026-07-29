/**
 * @fileoverview Prompt Library Island — matching Prompts.dc.html.
 * Features:
 *   - Category sidebar filter.
 *   - Cards with title, category, evidence track record grade, prompt text.
 *   - "Use Prompt" action button.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Camera,
  Check,
  Copy,
  Home,
  Layers,
  Library,
  Loader2,
  Package,
  Search,
  Sparkles,
  Star,
} from "lucide-react";

import { apiGet } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

interface Template {
  id: string;
  title: string;
  category: string;
  templateBody: string;
  source: string;
  useCount: number;
  avgGrade: number | null;
}

export function PromptsList() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadPrompts = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiGet<{ templates: Template[] }>("prompts");
      setTemplates(res.templates ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load prompt templates");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPrompts();
  }, [loadPrompts]);

  const categories = [
    { key: "all", label: "All templates", icon: Library },
    { key: "room", label: "Room visualisation", icon: Home },
    { key: "scene", label: "Photorealistic scenes", icon: Camera },
    { key: "product", label: "Product mockups", icon: Package },
  ];

  const handleUsePrompt = (t: Template) => {
    navigator.clipboard.writeText(t.templateBody);
    setCopiedId(t.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filtered = templates.filter((t) => {
    if (activeCategory !== "all" && !t.category.toLowerCase().includes(activeCategory)) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        t.title.toLowerCase().includes(q) ||
        t.templateBody.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="flex max-w-7xl flex-col gap-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/40 pb-5">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            PROMPT LIBRARY &bull; CORE-AI-TOOLS
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Prompt templates &amp; evidence library
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {templates.length} proven prompt templates &bull; Rated by revision track record evidence
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search templates..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-card ring-1 ring-border/40"
            />
          </div>
        </div>
      </div>

      {/* Main Split: Category Sidebar + Cards Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* Sidebar */}
        <div className="flex flex-col gap-1.5 rounded-xl bg-card p-4 ring-1 ring-border/40">
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Categories
          </span>

          {categories.map((c) => {
            const Icon = c.icon;
            const count =
              c.key === "all"
                ? templates.length
                : templates.filter((t) => t.category.toLowerCase().includes(c.key)).length;
            const isActive = activeCategory === c.key;
            return (
              <button
                key={c.key}
                onClick={() => setActiveCategory(c.key)}
                className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-muted font-medium text-foreground ring-1 ring-border/40"
                    : "text-muted-foreground hover:bg-accent/10 hover:text-foreground"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span>{c.label}</span>
                </div>
                <span className="font-mono text-xs text-muted-foreground">{count}</span>
              </button>
            );
          })}
        </div>

        {/* Prompt Cards Grid */}
        <div>
          {loading ? (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mr-2 text-primary" />
              <span>Loading templates...</span>
            </div>
          ) : error ? (
            <div className="rounded-xl bg-card p-6 text-sm text-destructive ring-1 ring-border/40">
              {error}
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl bg-card p-12 text-center ring-1 ring-border/40">
              <Sparkles className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
              <h3 className="text-base font-semibold text-foreground">No prompt templates found</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Try selecting a different category or search term.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filtered.map((t) => (
                <div
                  key={t.id}
                  className="flex flex-col justify-between gap-3 rounded-xl bg-card p-5 ring-1 ring-border/40 hover:ring-primary/40 transition-all"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-foreground text-sm">{t.title}</h3>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {t.avgGrade != null && (
                          <span className="flex items-center gap-1 rounded bg-amber-500/10 px-2 py-0.5 font-mono text-xs font-medium text-amber-300 ring-1 ring-amber-500/30">
                            <Star className="h-3 w-3 fill-amber-300" />
                            {t.avgGrade.toFixed(1)}
                          </span>
                        )}
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {t.category}
                        </Badge>
                      </div>
                    </div>

                    <p className="font-mono text-xs text-muted-foreground line-clamp-3 leading-relaxed">
                      {t.templateBody}
                    </p>
                  </div>

                  <div className="flex items-center justify-between border-t border-border/40 pt-3 text-xs text-muted-foreground">
                    <span className="font-mono text-[11px]">
                      Used {t.useCount} times &bull; {t.source === "promoted" ? "Promoted" : "Seeded"}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleUsePrompt(t)}
                      className="h-8 gap-1.5 ring-1 ring-border/40 font-mono text-xs"
                    >
                      {copiedId === t.id ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-400" /> Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" /> Copy Prompt
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
