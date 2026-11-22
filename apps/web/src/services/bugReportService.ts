import { rpc } from "@/lib/cloud";
import {
  createBugReportSchema,
  listBugReportsFilterSchema,
  updateBugReportStatusSchema,
  type BugReport,
  type CreateBugReportInput,
  type ListBugReportsFilterInput,
  type UpdateBugReportStatusInput,
} from "@qizzone/domain";

export const bugReportService = {
  createReport: (input: CreateBugReportInput) => {
    const parsed = createBugReportSchema.parse(input);
    return rpc<BugReport>("create_bug_report", {
      p_title: parsed.title,
      p_description: parsed.description,
      p_category: parsed.category,
      p_severity: parsed.severity,
      p_page_route: parsed.pageRoute ?? null,
      p_context_metadata: parsed.contextMetadata ?? {},
    });
  },

  listReports: (filters?: ListBugReportsFilterInput) => {
    const parsed = listBugReportsFilterSchema.parse(filters ?? {});
    return rpc<BugReport[]>("list_bug_reports", {
      p_status: parsed.status ?? null,
      p_role: parsed.role ?? null,
    });
  },

  updateStatus: (input: UpdateBugReportStatusInput) => {
    const parsed = updateBugReportStatusSchema.parse(input);
    return rpc<BugReport>("update_bug_report_status", {
      p_report_id: parsed.reportId,
      p_status: parsed.status,
      p_admin_response: parsed.adminResponse ?? null,
    });
  },
};
