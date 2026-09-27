/**
 * @fileoverview `core/folders` barrel — inheritable folder settings.
 *
 * Folder CRUD (create / rename / move-with-cycle-check / list) lives in
 * `core/library/folders.ts` and is re-exported from `core/library`; this module
 * adds only the settings layer on top of it, so there is exactly one cycle check
 * and one folder-existence check in the codebase.
 */

export * from "./settings";
