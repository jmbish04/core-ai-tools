import { Badge, type BadgeProps } from "@/components/reui/badge"
import {
  Frame,
  FrameHeader,
  FramePanel,
} from "@/components/reui/frame"
import {
  Timeline,
  TimelineContent,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
} from "@/components/reui/timeline"
import { cn } from "@/lib/utils"
import { CheckIcon, ChevronRightIcon, CircleIcon } from "lucide-react"

import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@/components/ui/avatar"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Spinner } from "@/components/ui/spinner"
import {
  activationSteps,
  type ActivationFeedback,
  type ActivationStatus,
} from "./data"
import { FlagIcon, LayoutDashboardIcon, MessageSquareIcon, CalendarIcon } from "lucide-react"

const feedbackPriorityVariant: Record<
  ActivationFeedback["priority"],
  BadgeProps["variant"]
> = {
  High: "warning-light",
  Medium: "info-light",
  Low: "success-light",
}

const feedbackStatusVariant: Record<
  ActivationFeedback["status"],
  BadgeProps["variant"]
> = {
  Ready: "success-light",
  Pending: "warning-light",
  Blocked: "destructive-light",
}

const feedbackStatusDotClass: Record<ActivationFeedback["status"], string> = {
  Ready: "bg-success",
  Pending: "bg-warning",
  Blocked: "bg-destructive",
}

function StatusIcon({ status }: { status: ActivationStatus }) {
  if (status === "completed") {
    return <CheckIcon className="size-3.5" />
  }

  if (status === "active") {
    return <Spinner className="size-3.5" />
  }

  return <CircleIcon className="size-3.5" />
}

function FeedbackContent({ feedback }: { feedback: ActivationFeedback }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge
          variant={feedbackPriorityVariant[feedback.priority]}
          className="gap-1.5"
        >
          <FlagIcon className="size-3.5" aria-hidden="true" />
          {feedback.priority}
        </Badge>
        <Badge
          variant={feedbackStatusVariant[feedback.status]}
          className="gap-1.5"
        >
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              feedbackStatusDotClass[feedback.status]
            )}
            aria-hidden="true"
          />
          {feedback.status}
        </Badge>
        <Badge variant="outline" className="gap-1.5">
          <LayoutDashboardIcon className="size-3.5" aria-hidden="true" />
          {feedback.surface}
        </Badge>
      </div>

      <div className="space-y-1">
        <div className="text-foreground text-sm leading-5 font-semibold">
          {feedback.title}
        </div>
        <p className="text-muted-foreground text-xs leading-5">
          {feedback.description}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2.5 border-t pt-3.5">
        <AvatarGroup
          aria-label={`Assignees for ${feedback.title}`}
          className="-space-x-1"
        >
          {feedback.assignees.map((assignee) => (
            <Avatar key={assignee.id} className="size-6">
              <AvatarImage src={assignee.avatar} alt={assignee.name} />
              <AvatarFallback className="text-[10px]">
                {assignee.initials}
              </AvatarFallback>
            </Avatar>
          ))}
          {feedback.overflowCount > 0 ? (
            <AvatarGroupCount className="bg-background size-6 border text-[10px] tabular-nums">
              +{feedback.overflowCount}
            </AvatarGroupCount>
          ) : null}
        </AvatarGroup>

        <div className="text-muted-foreground flex items-center gap-2.5 text-xs">
          <span className="inline-flex items-center gap-1">
            <MessageSquareIcon className="size-3.5" aria-hidden="true" />
            <span className="text-foreground font-medium tabular-nums">
              {feedback.comments}
            </span>
          </span>
          <span className="inline-flex items-center gap-1">
            <CalendarIcon className="size-3.5" aria-hidden="true" />
            <span className="text-foreground font-medium">{feedback.due}</span>
          </span>
        </div>
      </div>
    </div>
  )
}

export function CustomerActivationTimeline() {
  return (
    <section className="w-full max-w-xl" aria-labelledby="timeline-title">
      <div className="mb-6 space-y-1">
        <h1 id="timeline-title" className="text-xl font-semibold">
          Activation Timeline
        </h1>
        <p className="text-muted-foreground text-sm leading-5">
          Track onboarding milestones.
        </p>
      </div>

      <Timeline defaultValue={2}>
        {activationSteps.map((step) => (
          <TimelineItem key={step.id} step={step.id} className="ms-10 pb-10">
            <TimelineHeader>
              <TimelineSeparator className="bg-border group-data-[orientation=vertical]/timeline:-left-7 group-data-[orientation=vertical]/timeline:h-[calc(100%-1.5rem-0.5rem)] group-data-[orientation=vertical]/timeline:translate-y-7" />
              <div className="flex flex-wrap items-center gap-2">
                <TimelineTitle className="text-sm font-semibold">
                  {step.title}
                </TimelineTitle>
              </div>
              <TimelineIndicator className="bg-muted text-muted-foreground group-data-completed/timeline-item:bg-primary group-data-completed/timeline-item:text-primary-foreground flex size-6 items-center justify-center border-none group-data-[orientation=vertical]/timeline:-left-7">
                <StatusIcon status={step.status} />
              </TimelineIndicator>
            </TimelineHeader>
            <TimelineContent className="mt-2">
              <Frame stacked dense spacing="sm">
                <Collapsible
                  defaultOpen={step.id === 2}
                  className="group/collapsible"
                >
                  <CollapsibleTrigger
                    type="button"
                    className="flex w-full"
                    aria-label={`Toggle ${step.title} details`}
                  >
                    <FrameHeader className="flex grow flex-row items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <Avatar className="size-5">
                          <AvatarImage
                            src={step.owner.avatar}
                            alt={step.owner.name}
                          />
                          <AvatarFallback>
                            {step.owner.name.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-muted-foreground min-w-0 truncate text-sm font-medium">
                          {step.owner.name} / {step.owner.role}
                        </span>
                      </div>
                      <ChevronRightIcon
                        className="text-muted-foreground size-4 shrink-0 transition-transform duration-200 group-data-open/collapsible:rotate-90"
                        aria-hidden="true"
                      />
                    </FrameHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <FramePanel className="space-y-3.5">
                      <FeedbackContent feedback={step.feedback} />
                    </FramePanel>
                  </CollapsibleContent>
                </Collapsible>
              </Frame>
            </TimelineContent>
          </TimelineItem>
        ))}
      </Timeline>
    </section>
  )
}