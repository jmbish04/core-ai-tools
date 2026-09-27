import { useState } from "react"
import { Badge } from "@/components/reui/badge"

import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarImage,
} from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Item } from "@/components/ui/item"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  getInitials,
  LINK_ACCESS,
  SHARE_ROLES,
  type DriveRow,
  type LinkAccess,
  type SharePrincipal,
  type ShareRole,
  type ShareTeam,
} from "./data"
import { OptionSelect } from "./option-select"
import { XIcon, UserPlusIcon, LinkIcon, GlobeIcon } from "lucide-react"

// prettier-ignore
const ICONS = {
  close: <XIcon aria-hidden="true" />,
  invite: <UserPlusIcon data-icon="inline-start" aria-hidden="true" />,
  link: <LinkIcon data-icon="inline-start" aria-hidden="true" />,
  globe: <GlobeIcon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />,
}

/**
 * The select trigger is justify-between, which parks the label on the far left
 * of a fixed-width control. justify-end walks it back beside the chevron so
 * every role reads off one right edge.
 */
const SELECT_ALIGN = "justify-end gap-1.5"

/** One width for every trailing role control, so the rows share a right edge. */
const ROW_ROLE_CLASS = `w-[136px] shrink-0 ${SELECT_ALIGN}`

const REMOVE_ACCESS = "remove-access"

/** A person's access list ends in taking it away; a team's does not. */
const PERSON_ROLE_OPTIONS = [
  ...SHARE_ROLES,
  {
    value: REMOVE_ACCESS,
    label: "Remove access",
    description: "Revokes this person",
    destructive: true,
  },
]

/**
 * One 40px media column for both row kinds: a single portrait for a person, a
 * three-face stack for a team. The column is sized to the stack so the names
 * keep one left edge either way.
 */
function RowMedia({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center">
      {children}
    </span>
  )
}

function Section({
  label,
  hint,
  action,
  children,
}: {
  label: string
  hint?: string
  /** A control that belongs to this group, sat on its header row. */
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {/* min-h holds the row steady whether or not it carries a control, so
          the two section headers keep one rhythm. */}
      <div className="flex min-h-7 items-center justify-between gap-2">
        <p className="text-muted-foreground shrink-0 text-xs font-medium tracking-wide uppercase">
          {label}
        </p>
        <div className="flex min-w-0 items-center gap-2">
          {hint ? (
            <p className="text-muted-foreground min-w-0 truncate text-xs">
              {hint}
            </p>
          ) : null}
          {action}
        </div>
      </div>
      {children}
    </div>
  )
}

function PersonRow({
  person,
  onRoleChange,
  onRemove,
}: {
  person: SharePrincipal
  onRoleChange: (id: string, role: ShareRole) => void
  onRemove: (id: string) => void
}) {
  return (
    <Item size="sm" className="min-w-0 flex-nowrap gap-2.5 px-0 py-1">
      <RowMedia>
        <Avatar className="size-8">
          {person.avatar ? <AvatarImage src={person.avatar} alt="" /> : null}
          <AvatarFallback className="text-[10px]">
            {getInitials(person.name)}
          </AvatarFallback>
        </Avatar>
      </RowMedia>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{person.name}</span>
        <span className="text-muted-foreground truncate text-xs">
          {person.email}
        </span>
      </div>
      {person.owner ? (
        /* Tinted, not secondary: secondary is oklch(0.97) on an oklch(1)
           panel, so the chip disappears and only its text carries. */
        <span className="flex w-[136px] shrink-0 justify-end">
          <Badge variant="primary-light">Owner</Badge>
        </span>
      ) : (
        /* Removal lives in the role list rather than a button beside it: the
           menu answers "what access does this person have", and none is an
           answer. It also leaves the row's right edge to the control alone. */
        <OptionSelect
          value={person.role}
          options={PERSON_ROLE_OPTIONS}
          ariaLabel={`Access for ${person.name}`}
          className={ROW_ROLE_CLASS}
          contentClassName="w-64"
          onChange={(next) =>
            next === REMOVE_ACCESS
              ? onRemove(person.id)
              : onRoleChange(person.id, next as ShareRole)
          }
        />
      )}
    </Item>
  )
}

function TeamRow({
  team,
  onRoleChange,
}: {
  team: ShareTeam
  onRoleChange: (id: string, role: ShareRole) => void
}) {
  return (
    <Item size="sm" className="min-w-0 flex-nowrap gap-2.5 px-0 py-1">
      {/* Real members, not a generic glyph: one grey tile per team said
          nothing about which team it was. Three 20px avatars overlapped 10px
          measure exactly the 40px column, so each face stays half visible
          while the rows stay dense. */}
      <RowMedia>
        <AvatarGroup
          aria-label={`${team.name} members`}
          className="-space-x-2.5"
        >
          {team.members.map((member) => (
            <Avatar key={member.name} className="size-5">
              {member.avatar ? (
                <AvatarImage src={member.avatar} alt="" />
              ) : null}
              <AvatarFallback className="text-[8px]">
                {getInitials(member.name)}
              </AvatarFallback>
            </Avatar>
          ))}
        </AvatarGroup>
      </RowMedia>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{team.name}</span>
        <span className="text-muted-foreground truncate text-xs">
          {team.memberLabel}
        </span>
      </div>
      <OptionSelect
        value={team.role}
        options={SHARE_ROLES}
        ariaLabel={`Role for ${team.name}`}
        className={ROW_ROLE_CLASS}
        contentClassName="w-64"
        onChange={(next) => onRoleChange(team.id, next)}
      />
    </Item>
  )
}

export function ShareSheet({
  target,
  principals,
  teams,
  linkAccess,
  linkRole,
  onOpenChange,
  onInvite,
  onRoleChange,
  onRemove,
  onTeamRoleChange,
  onLinkAccessChange,
  onLinkRoleChange,
  onCopyLink,
}: {
  target: DriveRow | null
  principals: SharePrincipal[]
  teams: ShareTeam[]
  linkAccess: LinkAccess
  linkRole: ShareRole
  onOpenChange: (open: boolean) => void
  onInvite: (email: string, role: ShareRole) => void
  onRoleChange: (id: string, role: ShareRole) => void
  onRemove: (id: string) => void
  onTeamRoleChange: (id: string, role: ShareRole) => void
  onLinkAccessChange: (next: LinkAccess) => void
  onLinkRoleChange: (next: ShareRole) => void
  onCopyLink: () => void
}) {
  const [email, setEmail] = useState("")
  const [inviteRole, setInviteRole] = useState<ShareRole>("viewer")
  const [inviteOpen, setInviteOpen] = useState(false)

  const trimmed = email.trim()
  const canInvite = trimmed.includes("@")

  function invite() {
    if (!canInvite) return
    onInvite(trimmed, inviteRole)
    setEmail("")
  }

  return (
    <Sheet open={target !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        initialFocus={false}
        className="inset-y-4 right-4 left-auto flex h-[calc(100svh-2rem)] w-[min(30rem,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden rounded-xl p-0 outline-none"
      >
        <SheetHeader className="shrink-0 border-b px-4 pt-4 pb-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <SheetTitle className="truncate text-sm leading-5">
                Share with people and teams
              </SheetTitle>
              <SheetDescription className="truncate text-xs">
                {target?.node.name ?? "Nothing selected"}
              </SheetDescription>
            </div>
            <SheetClose
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Close sheet"
                  className="-me-1.5 -mt-1.5 shrink-0"
                >
                  {ICONS.close}
                </Button>
              }
            />
          </div>
        </SheetHeader>

        {/* min-h-0 lets the body shrink so the footer never leaves the sheet */}
        <div className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="flex flex-col gap-4 px-4 py-3">
              {/* Collapsed by default: most visits to this sheet are to read
                  or adjust who already has access, not to add someone. */}
              <Collapsible
                open={inviteOpen}
                onOpenChange={setInviteOpen}
                className="flex flex-col"
              >
                {/* The invite control belongs to the group it adds to, so it
                    sits on that group's header as a plain button rather than
                    a full-width bar that reads like a select. */}
                <Section
                  label="People with access"
                  hint={`${principals.length} people`}
                  action={
                    <CollapsibleTrigger
                      render={
                        <Button type="button" variant="outline" size="sm">
                          {ICONS.invite}
                          Invite
                        </Button>
                      }
                    />
                  }
                >
                  <CollapsibleContent className="pb-2">
                    {/* Three peer controls on one baseline. The role stays
                        outside the field: a bordered select nested in a
                        bordered field reads as a box inside a box. */}
                    <div className="flex items-center gap-2">
                      <Input
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") invite()
                        }}
                        placeholder="name@rivermark.studio"
                        aria-label="Invite by email"
                        autoComplete="off"
                        className="min-w-0 flex-1"
                      />
                      <OptionSelect
                        value={inviteRole}
                        options={SHARE_ROLES}
                        ariaLabel="Invite role"
                        className={ROW_ROLE_CLASS}
                        contentClassName="w-64"
                        onChange={setInviteRole}
                      />
                      <Button
                        type="button"
                        disabled={!canInvite}
                        onClick={invite}
                      >
                        Share
                      </Button>
                    </div>
                  </CollapsibleContent>

                  <div className="flex flex-col">
                    {principals.map((person) => (
                      <PersonRow
                        key={person.id}
                        person={person}
                        onRoleChange={onRoleChange}
                        onRemove={onRemove}
                      />
                    ))}
                  </div>
                </Section>
              </Collapsible>

              <Section label="Teams with access" hint={`${teams.length} teams`}>
                <div className="flex flex-col">
                  {teams.map((team) => (
                    <TeamRow
                      key={team.id}
                      team={team}
                      onRoleChange={onTeamRoleChange}
                    />
                  ))}
                </div>
              </Section>
            </div>
          </ScrollArea>
        </div>

        {/* Scope, then what it permits, then the action it produces. */}
        <SheetFooter className="bg-muted shrink-0 flex-row items-center gap-2 border-t px-4 py-3">
          {ICONS.globe}
          <OptionSelect
            value={linkAccess}
            options={LINK_ACCESS}
            ariaLabel="Link access"
            className={`w-[152px] shrink-0 ${SELECT_ALIGN}`}
            contentClassName="w-64"
            onChange={onLinkAccessChange}
          />
          {/* A link role means nothing while the link is restricted */}
          {linkAccess === "anyone" ? (
            <OptionSelect
              value={linkRole}
              options={SHARE_ROLES}
              ariaLabel="Link role"
              className={ROW_ROLE_CLASS}
              contentClassName="w-64"
              onChange={onLinkRoleChange}
            />
          ) : null}
          <Button
            type="button"
            className="ms-auto shrink-0"
            onClick={onCopyLink}
          >
            {ICONS.link}
            Copy Link
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}