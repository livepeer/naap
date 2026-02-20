import { Prisma } from '../generated/client/index.js';
import type { PrismaClient } from '../generated/client/index.js';

export class DevApiProjectResolutionError extends Error {
  public readonly code: 'INVALID_PROJECT_ID';

  constructor(message: string, code: 'INVALID_PROJECT_ID' = 'INVALID_PROJECT_ID') {
    super(message);
    this.name = 'DevApiProjectResolutionError';
    this.code = code;
  }
}

function isPrismaUniqueConstraintError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === 'P2002';
  }
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

export async function resolveDevApiProjectId(params: {
  prisma: Pick<PrismaClient, 'devApiProject'>;
  userId: string;
  projectId?: string | undefined;
  projectName?: string | undefined;
  defaultProjectName?: string | undefined;
}): Promise<string> {
  const {
    prisma,
    userId,
    projectId,
    projectName,
    defaultProjectName = 'Default',
  } = params;

  if (projectId) {
    const project = await prisma.devApiProject.findUnique({
      where: { id: projectId },
      select: { id: true, userId: true },
    });
    if (!project || project.userId !== userId) {
      throw new DevApiProjectResolutionError('Invalid projectId');
    }
    return project.id;
  }

  if (projectName && projectName.trim()) {
    const trimmedName = projectName.trim();
    let project = await prisma.devApiProject.findUnique({
      where: { userId_name: { userId, name: trimmedName } },
      select: { id: true },
    });

    if (!project) {
      try {
        project = await prisma.devApiProject.create({
          data: {
            userId,
            name: trimmedName,
            isDefault: false,
          },
          select: { id: true },
        });
      } catch (error) {
        if (!isPrismaUniqueConstraintError(error)) {
          throw error;
        }
        project = await prisma.devApiProject.findUnique({
          where: { userId_name: { userId, name: trimmedName } },
          select: { id: true },
        });
        if (!project) {
          throw error;
        }
      }
    }

    return project.id;
  }

  let defaultProject = await prisma.devApiProject.findFirst({
    where: { userId, isDefault: true },
    select: { id: true },
  });

  if (!defaultProject) {
    try {
      defaultProject = await prisma.devApiProject.create({
        data: {
          userId,
          name: defaultProjectName,
          isDefault: true,
        },
        select: { id: true },
      });
    } catch (error) {
      if (!isPrismaUniqueConstraintError(error)) {
        throw error;
      }
      defaultProject = await prisma.devApiProject.findFirst({
        where: { userId, isDefault: true },
        select: { id: true },
      });
      if (!defaultProject) {
        throw error;
      }
    }
  }

  return defaultProject.id;
}

