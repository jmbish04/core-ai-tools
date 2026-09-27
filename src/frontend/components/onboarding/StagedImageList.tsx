/**
 * @fileoverview Wizard step 3 — upload images and say what each one is for.
 *
 * Bytes go browser → Cloudflare Images directly, never through the Worker: the
 * upload-intent route mints a one-time URL and the file is POSTed straight to
 * it, then `complete-upload` registers the row. Proxying megabytes through a
 * Worker is the thing that flow exists to avoid.
 *
 * Roles are the point of this step. `base` is the picture being edited;
 * `reference` is something to borrow a look from; `inject` is an object to place
 * INTO the base — the kitchen island, the garment. The model prompt is built
 * differently for each, so getting this wrong is not cosmetic.
 */

import { useRef, useState } from "react";
import { ImagePlusIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiSend } from "@/lib/api";
import { thumbOf } from "@/components/assets/types";
import type { ImageRole, StagedImage } from "./types";

const ROLES: { id: ImageRole; label: string; hint: string }[] = [
  { id: "base", label: "Base", hint: "The picture being changed" },
  { id: "reference", label: "Reference", hint: "A look to borrow" },
  { id: "inject", label: "Inject", hint: "An object to place in" },
];

export function StagedImageList({
  images,
  onChange,
}: {
  images: StagedImage[];
  onChange: (images: StagedImage[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (files: FileList) => {
    setBusy(true);
    setError(null);
    const added: StagedImage[] = [];
    try {
      for (const file of Array.from(files)) {
        const intent = await apiSend<{ uploadURL: string; id: string }>(
          "POST",
          "library/upload-intent",
          {},
        );
        const form = new FormData();
        form.append("file", file);
        const res = await fetch(intent.uploadURL, { method: "POST", body: form });
        if (!res.ok) throw new Error(`Upload failed for ${file.name} (${res.status}).`);

        const row = await apiSend<{ id: string; publicId: string | null; deliveryUrl: string }>(
          "POST",
          "library/complete-upload",
          {
            cfImageId: intent.id,
            originalFilename: file.name,
            contentType: file.type,
            bytes: file.size,
          },
        );
        added.push({
          imageId: row.id,
          publicId: row.publicId,
          deliveryUrl: row.deliveryUrl,
          filename: file.name,
          // First picture in is almost always the thing being edited.
          role: images.length + added.length === 0 ? "base" : "reference",
          note: "",
        });
      }
      onChange([...images, ...added]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const update = (imageId: string, next: Partial<StagedImage>) =>
    onChange(images.map((img) => (img.imageId === imageId ? { ...img, ...next } : img)));

  return (
    <div className="space-y-4">
      <div className="border-border rounded-md border border-dashed p-6 text-center">
        <ImagePlusIcon className="text-muted-foreground mx-auto size-6" aria-hidden="true" />
        <p className="text-foreground mt-2 text-sm font-medium">Add images</p>
        <p className="text-muted-foreground mt-1 text-sm">
          They upload straight to Cloudflare Images and land in this project when you finish.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          onChange={(e) => e.target.files && void upload(e.target.files)}
        />
        <Button
          size="sm"
          variant="outline"
          className="mt-3"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? "Uploading…" : "Choose files"}
        </Button>
        {error ? <p className="text-destructive-foreground mt-2 text-sm">{error}</p> : null}
      </div>

      {images.length > 0 ? (
        <ul className="space-y-3">
          {images.map((img) => (
            <li
              key={img.imageId}
              className="border-border bg-background flex gap-4 rounded-md border p-3"
            >
              <img
                src={thumbOf(img.deliveryUrl)}
                alt={img.filename}
                className="size-20 shrink-0 rounded object-cover"
              />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-foreground truncate text-sm font-medium">{img.filename}</p>
                    {img.publicId ? (
                      <p className="text-muted-foreground font-mono text-[11px]">{img.publicId}</p>
                    ) : null}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => onChange(images.filter((i) => i.imageId !== img.imageId))}
                  >
                    <Trash2Icon className="size-4" aria-hidden="true" />
                    <span className="sr-only">Remove {img.filename}</span>
                  </Button>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {ROLES.map((role) => (
                    <button
                      key={role.id}
                      type="button"
                      title={role.hint}
                      aria-pressed={img.role === role.id}
                      onClick={() => update(img.imageId, { role: role.id })}
                      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                        img.role === role.id
                          ? "border-primary bg-accent text-accent-foreground"
                          : "border-border text-muted-foreground hover:bg-accent/40"
                      }`}
                    >
                      {role.label}
                    </button>
                  ))}
                </div>

                <div className="space-y-1">
                  <Label htmlFor={`note-${img.imageId}`} className="sr-only">
                    What this image is for
                  </Label>
                  <Input
                    id={`note-${img.imageId}`}
                    value={img.note}
                    onChange={(e) => update(img.imageId, { note: e.target.value })}
                    placeholder="What it is for — 'the island we want', 'this fabric'"
                    className="h-8"
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
