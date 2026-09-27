export type ActivationStatus = "completed" | "active" | "pending"

export type ActivationFeedbackAssignee = {
  id: string
  name: string
  initials: string
  avatar: string
}

export type ActivationFeedback = {
  priority: "High" | "Medium" | "Low"
  status: "Ready" | "Pending" | "Blocked"
  surface: string
  title: string
  description: string
  comments: number
  due: string
  assignees: ActivationFeedbackAssignee[]
  overflowCount: number
}

export type ActivationStep = {
  id: number
  title: string
  status: ActivationStatus
  feedback: ActivationFeedback
  owner: {
    name: string
    role: string
    avatar: string
  }
}

export const activationSteps: ActivationStep[] = [
  {
    id: 1,
    title: "Contract Signed",
    status: "completed",
    feedback: {
      priority: "High",
      status: "Ready",
      surface: "Sales Handoff",
      title: "Implementation Kickoff Review",
      description:
        "Customer notes are ready for the workspace setup team before provisioning starts.",
      comments: 5,
      due: "Tomorrow",
      assignees: [
        {
          id: "maya-brooks",
          name: "Maya Brooks",
          initials: "MB",
          avatar:
            "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=96&h=96&dpr=2&q=80",
        },
        {
          id: "jon-bell",
          name: "Jon Bell",
          initials: "JB",
          avatar:
            "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=96&h=96&dpr=2&q=80",
        },
      ],
      overflowCount: 1,
    },
    owner: {
      name: "Maya Brooks",
      role: "Revenue Operations",
      avatar:
        "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=96&h=96&dpr=2&q=80",
    },
  },
  {
    id: 2,
    title: "Workspace Provisioning",
    status: "active",
    feedback: {
      priority: "Medium",
      status: "Pending",
      surface: "Identity Setup",
      title: "Admin Group Mapping",
      description:
        "SCIM groups are being matched to launch roles before the first admin invites go out.",
      comments: 3,
      due: "Today",
      assignees: [
        {
          id: "nina-patel",
          name: "Nina Patel",
          initials: "NP",
          avatar:
            "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=96&h=96&dpr=2&q=80",
        },
        {
          id: "theo-grant",
          name: "Theo Grant",
          initials: "TG",
          avatar:
            "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=96&h=96&dpr=2&q=80",
        },
      ],
      overflowCount: 2,
    },
    owner: {
      name: "Nina Patel",
      role: "Implementation Lead",
      avatar:
        "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=96&h=96&dpr=2&q=80",
    },
  },
  {
    id: 3,
    title: "Launch Readiness",
    status: "pending",
    feedback: {
      priority: "Low",
      status: "Pending",
      surface: "Go-live Plan",
      title: "Launch Checklist Review",
      description:
        "Support routing, billing owner access, and executive reporting need final confirmation.",
      comments: 2,
      due: "Apr 22",
      assignees: [
        {
          id: "leah-stone",
          name: "Leah Stone",
          initials: "LS",
          avatar:
            "https://images.unsplash.com/photo-1544723795-3fb6469f5b39?w=96&h=96&dpr=2&q=80",
        },
        {
          id: "theo-grant",
          name: "Theo Grant",
          initials: "TG",
          avatar:
            "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=96&h=96&dpr=2&q=80",
        },
      ],
      overflowCount: 1,
    },
    owner: {
      name: "Leah Stone",
      role: "Account Executive",
      avatar:
        "https://images.unsplash.com/photo-1544723795-3fb6469f5b39?w=96&h=96&dpr=2&q=80",
    },
  },
]