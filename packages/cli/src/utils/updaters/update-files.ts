import type { Config } from '@/src/utils/get-config'
import type { RegistryItem } from '@/src/utils/registry/schema'
import { existsSync, promises as fs } from 'node:fs'
import { getProjectInfo } from '@/src/utils/get-project-info'
import { highlighter } from '@/src/utils/highlighter'
import { logger } from '@/src/utils/logger'
import {
  getRegistryBaseColor,
  getRegistryItemFileTargetPath,
} from '@/src/utils/registry'
import { spinner } from '@/src/utils/spinner'
import { transform } from '@/src/utils/transformers'
import path, { basename, dirname } from 'pathe'
// import { transformIcons } from '@/src/utils/transformers/transform-icons'
import prompts from 'prompts'

export function resolveTargetDir(
  projectInfo: Awaited<ReturnType<typeof getProjectInfo>>,
  config: Config,
  target: string,
) {
  if (target.startsWith('~/')) {
    return path.join(config.resolvedPaths.cwd, target.replace('~/', ''))
  }
  return path.join(config.resolvedPaths.cwd, target)
  // return projectInfo?.isSrcDir
  //   ? path.join(config.resolvedPaths.cwd, 'src', target)
  //   : path.join(config.resolvedPaths.cwd, target)
}

export async function updateFiles(
  files: RegistryItem['files'],
  config: Config,
  options: {
    overwrite?: boolean
    force?: boolean
    silent?: boolean
  },
) {
  if (!files?.length) {
    return
  }
  options = {
    overwrite: false,
    force: false,
    silent: false,
    ...options,
  }
  const filesCreatedSpinner = spinner(`Updating files.`, {
    silent: options.silent,
  })?.start()

  const [projectInfo, baseColor] = await Promise.all([
    getProjectInfo(config.resolvedPaths.cwd),
    getRegistryBaseColor(config.tailwind.baseColor),
  ])

  const filesCreated = []
  const filesUpdated = []
  const folderSkipped = new Map<string, boolean>()
  const filesSkipped = []

  for (const file of files) {
    if (!file.content) {
      continue
    }

    let targetDir = getRegistryItemFileTargetPath(file, config)
    const fileName = basename(file.path)
    let filePath = path.join(targetDir, fileName)

    if (file.target) {
      filePath = resolveTargetDir(projectInfo, config, file.target)
      targetDir = path.dirname(filePath)
    }

    if (!config.typescript) {
      filePath = filePath.replace(/\.ts?$/, match => '.js')
    }

    const existingFile = existsSync(filePath)

    // Check for existing folder in UI component only
    if (file.type === 'registry:ui') {
      const folderName = basename(dirname(filePath))
      const existingFolder = existsSync(dirname(filePath))

      if (!existingFolder) {
        folderSkipped.set(folderName, false)
      }

      if (!folderSkipped.has(folderName)) {
        filesCreatedSpinner.stop()
        const { overwrite } = await prompts({
          type: 'confirm',
          name: 'overwrite',
          message: `The folder ${highlighter.info(folderName)} already exists. Would you like to overwrite?`,
          initial: false,
        })
        folderSkipped.set(folderName, !overwrite)
        filesCreatedSpinner?.start()
      }

      if (folderSkipped.get(folderName) === true) {
        filesSkipped.push(path.relative(config.resolvedPaths.cwd, filePath))
        continue
      }
    }
    else {
      if (existingFile && !options.overwrite) {
        filesCreatedSpinner.stop()
        const { overwrite } = await prompts({
          type: 'confirm',
          name: 'overwrite',
          message: `The file ${highlighter.info(
            fileName,
          )} already exists. Would you like to overwrite?`,
          initial: false,
        })

        if (!overwrite) {
          filesSkipped.push(path.relative(config.resolvedPaths.cwd, filePath))
          continue
        }
        filesCreatedSpinner?.start()
      }
    }

    // Create the target directory if it doesn't exist.
    if (!existsSync(targetDir)) {
      await fs.mkdir(targetDir, { recursive: true })
    }

    // Run our transformers.
    const content = await transform({
      filename: file.path,
      raw: file.content,
      config,
      baseColor,
    })

    await fs.writeFile(filePath, content, 'utf-8')
    existingFile
      ? filesUpdated.push(path.relative(config.resolvedPaths.cwd, filePath))
      : filesCreated.push(path.relative(config.resolvedPaths.cwd, filePath))
  }

  const hasUpdatedFiles = filesCreated.length || filesUpdated.length
  if (!hasUpdatedFiles && !filesSkipped.length) {
    filesCreatedSpinner?.info('No files updated.')
  }

  if (filesCreated.length) {
    filesCreatedSpinner?.succeed(
      `Created ${filesCreated.length} ${
        filesCreated.length === 1 ? 'file' : 'files'
      }:`,
    )
    if (!options.silent) {
      for (const file of filesCreated) {
        logger.log(`  - ${file}`)
      }
    }
  }
  else {
    filesCreatedSpinner?.stop()
  }

  if (filesUpdated.length) {
    spinner(
      `Updated ${filesUpdated.length} ${
        filesUpdated.length === 1 ? 'file' : 'files'
      }:`,
      {
        silent: options.silent,
      },
    )?.info()
    if (!options.silent) {
      for (const file of filesUpdated) {
        logger.log(`  - ${file}`)
      }
    }
  }

  if (filesSkipped.length) {
    spinner(
      `Skipped ${filesSkipped.length} ${
        filesUpdated.length === 1 ? 'file' : 'files'
      }:`,
      {
        silent: options.silent,
      },
    )?.info()
    if (!options.silent) {
      for (const file of filesSkipped) {
        logger.log(`  - ${file}`)
      }
    }
  }

  if (!options.silent) {
    logger.break()
  }
}
