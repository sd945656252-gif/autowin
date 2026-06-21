WITH ranked_projects AS (
  SELECT
    id,
    name,
    ROW_NUMBER() OVER (
      PARTITION BY "createdById", lower(name)
      ORDER BY "createdAt", id
    ) AS duplicate_rank
  FROM "ProductionProject"
  WHERE "createdById" IS NOT NULL
)
UPDATE "ProductionProject" AS project
SET name = ranked_projects.name || ' (' || ranked_projects.duplicate_rank || ')'
FROM ranked_projects
WHERE project.id = ranked_projects.id
  AND ranked_projects.duplicate_rank > 1;

CREATE UNIQUE INDEX "ProductionProject_createdById_lower_name_key" ON "ProductionProject"("createdById", lower(name));
