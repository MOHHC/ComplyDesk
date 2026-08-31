-- CreateIndex
CREATE INDEX "Control_tenantId_category_idx" ON "Control"("tenantId", "category");

-- CreateIndex
CREATE INDEX "Evidence_tenantId_controlId_idx" ON "Evidence"("tenantId", "controlId");

-- CreateIndex
CREATE INDEX "Evidence_tenantId_status_idx" ON "Evidence"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Membership_tenantId_role_idx" ON "Membership"("tenantId", "role");

-- CreateIndex
CREATE INDEX "Task_tenantId_status_idx" ON "Task"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Task_tenantId_assigneeId_idx" ON "Task"("tenantId", "assigneeId");
