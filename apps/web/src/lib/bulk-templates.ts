/**
 * The bulk-upload CSV templates, in one place so they can be tested against
 * the validators that read them (bulk-templates.test.ts). Lines starting with
 * '#' are ignored by the parser, so the examples can stay in the file.
 */

export const IC_BULK_UPLOAD_TEMPLATE = `programme_code,course_code,semester
# Lines starting with '#' are ignored. Delete these examples or leave them — they are skipped.
# MTECH-SE,SE ZG501,Sem-I 2025-26
# MTECH-DS,CC ZG501,Sem-I 2025-26
`;

export const HOG_BULK_ALLOCATE_TEMPLATE = `request_reference,faculty_emails,sme_email
# Lines starting with '#' are ignored. Delete these examples or leave them — they are skipped.
# HMP-2026-0042,faculty@hmp.local,sme@hmp.local
# HMP-2026-0043,"a@hmp.local,b@hmp.local",sme@hmp.local
`;

export const HOG_BULK_REVIEW_TEMPLATE = `request_reference,action,comment
# action is one of: hog_final_approve | hog_reject | hog_rework.
# comment is required for hog_reject and hog_rework.
# HMP-2026-0042,hog_final_approve,
# HMP-2026-0043,hog_reject,Does not meet the programme's depth bar
`;

export const PC_BULK_REVIEW_TEMPLATE = `request_reference,action,comment
# action is one of: pc_approve | pc_rework. comment is required for pc_rework.
# HMP-2026-0042,pc_approve,
# HMP-2026-0043,pc_rework,Please tighten the evaluation rubric
`;

export const PC_ALLOCATION_REVIEW_TEMPLATE = `request_reference,action,comment
# action is one of: pc_confirm_allocation | pc_reject_allocation.
# comment is required for pc_reject_allocation (the reason HOG sees).
# HMP-2026-0042,pc_confirm_allocation,
# HMP-2026-0043,pc_reject_allocation,SME lacks expertise in distributed systems
`;

export const SME_BULK_REVIEW_TEMPLATE = `request_reference,action,comment
# action is one of: sme_approve | sme_revert. comment is required for sme_revert.
# HMP-2026-0042,sme_approve,
# HMP-2026-0043,sme_revert,Please add the experiential-learning component
`;
