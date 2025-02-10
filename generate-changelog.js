const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const conventionalCommitsParser = require("conventional-commits-parser");
const logger = require("./logger");
let config;
let svnHooksDir;
const svnHookDirName = ".svn-hooks";

// 从命令行参数获取仓库路径和提交消息文件路径
let cwdPath = process.argv[2];
let messageFilePath = process.argv[3];
logger.warn("如果要看详细日志, 请修改 logger.js 中的 this.debugEnable = true;");

if (!cwdPath || !fs.existsSync(cwdPath)) {
  logger.error(`提供的路径无效: ${cwdPath}`);
  process.exit(1);
}
// 查找包含 svnHookDirName 的目录
svnHooksDir = findSvnHooksDir(cwdPath);
if (!svnHooksDir) {
  logger.error(
    `未在目录 ${cwdPath} 或其父目录中找到包含 ${svnHookDirName} 的 目录`
  );
  process.exit(1);
} else {
  logger.warn(
    `找到包含 ${svnHookDirName} 的目录: ${svnHooksDir}, 请确保这是正确的仓库路径。`
  );
}

class ChangelogManager {
  constructor() {
    this.dataFile = path.join(
      svnHooksDir,
      svnHookDirName,
      "tmp",
      "changelog-data.json"
    );
    this.initialize();
  }

  initialize() {
    if (!fs.existsSync(this.dataFile)) {
      logger.warn(`未找到 ${this.dataFile} 文件，正在创建...`);
      const dir = path.dirname(this.dataFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        logger.info(`创建了 ${dir} 目录。`);
      }
      fs.writeFileSync(
        this.dataFile,
        JSON.stringify(
          {
            latestRev: 1,
            commits: {},
          },
          null,
          2
        )
      );
      logger.info(`changelog-data.json 文件已创建。`);
    }
  }

  // 增量获取SVN日志
  async fetchNewLogs() {
    const currentData = this.loadData();
    const newLogs = getSvnLogs(currentData.latestRev);
    logger.info(`Fetched newLogs since revision ${currentData.latestRev}`);
    logger.info(newLogs);
    let mergedData = this.mergeLogs(currentData, newLogs);
    // 从配置文件或外部输入获取初始版本
    const initialVersion = {
      major: 0,
      minor: 0,
      patch: 0,
    };

    const finalVersion = this.calculateSemver(mergedData, initialVersion);
    mergedData.version = finalVersion;
    logger.debug(`Final version: ${finalVersion}`);

    fs.writeFileSync(this.dataFile, JSON.stringify(mergedData, null, 2));
    return mergedData;
  }

  // 合并日志到中间存储
  mergeLogs(existingData, newLogs) {
    let maxRevision = existingData.latestRev;

    newLogs.forEach((log) => {
      // 确保revision是数字类型
      const revNum = Number(log.revision);
      if (isNaN(revNum)) {
        logger.warn(`Skipping log with invalid revision: ${log.revision}`);
        return;
      }

      // 更新最大修订号
      maxRevision = Math.max(maxRevision, revNum);

      // 更新commits
      existingData.commits[revNum] = {
        revision: revNum,
        author: log.author,
        date: log.date.toISOString(), // 确保日期格式统一
        message: log.message,
      };
    });

    // 确保更新latestRev
    existingData.latestRev = maxRevision;
    return existingData;
  }

  /**
   * 根据 Conventional Commits 规范计算语义化版本
   * @param {CommitData} mergedData
   * @param {SemVer} initialVersion
   * @returns {SemVer}
   */
  calculateSemver(mergedData, initialVersion) {
    // 深拷贝初始版本，避免污染原始配置
    let currentVersion = { ...initialVersion };

    // 按提交的 revision 升序处理（从旧到新）
    const revisions = Object.keys(mergedData.commits)
      .map((rev) => parseInt(rev))
      .sort((a, b) => a - b);

    revisions.forEach((rev) => {
      if (rev < 0) return; // 跳过HEAD
      this.trackVersionHistory(mergedData, currentVersion, rev);
    });

    // 单独处理 HEAD
    const rev = -1;
    this.trackVersionHistory(mergedData, currentVersion, rev);

    return currentVersion;
  }

  trackVersionHistory(mergedData, currentVersion, rev) {
    const commit = mergedData.commits[rev];
    const parsed = parseCommitMessage(commit);
    if ((!parsed || !parsed.type) && !config.other.showOtherCommitLogs) return;
    if (!parsed || !parsed.type) {
      // 如果解析失败，但配置允许显示其他提交日志，记录版本号但不更新版本号
      mergedData.commits[
        rev
      ].version = `${currentVersion.major}.${currentVersion.minor}.${currentVersion.patch}`;
      return; // 如果解析失败，跳过该提交，不更新版本号
    }

    // 提取提交类型和破坏性变更标记
    const { type, breaking } = parsed;

    // 根据优先级更新版本号
    if (breaking) {
      // 破坏性变更：升级 major，重置 minor/patch
      currentVersion.major += 1;
      currentVersion.minor = 0;
      currentVersion.patch = 0;
    } else if (type === "feat") {
      // 新功能：升级 minor，重置 patch
      currentVersion.minor += 1;
      currentVersion.patch = 0;
    } else if (type === "fix") {
      // 问题修复：仅升级 patch
      currentVersion.patch += 1;
    }
    mergedData.commits[
      rev
    ].version = `${currentVersion.major}.${currentVersion.minor}.${currentVersion.patch}`;
  }

  // 生成最终changelog
  generate() {
    const mergedData = JSON.parse(fs.readFileSync(this.dataFile, "utf8"));
    let versionRelease = { versions: [] }; // 默认值
    const versionReleasePath = path.join(svnHooksDir, "version-release.json");
    try {
      const rawData = fs.readFileSync(versionReleasePath, "utf8");
      versionRelease = JSON.parse(rawData);

      // 验证数据结构
      if (!Array.isArray(versionRelease.versions)) {
        logger.warn(`${versionReleasePath} 文件中的 格式错误，使用默认配置`);
        versionRelease = { versions: [] };
      }
    } catch (error) {
      if (error.code === "ENOENT") {
        logger.warn(
          `${versionReleasePath} 文件 不存在，所有提交将被视为未发布`
        );
      } else if (error instanceof SyntaxError) {
        logger.error(`${versionReleasePath} JSON 解析失败: ${error.message}`);
      } else {
        logger.error(`读取 ${versionReleasePath} 失败: ${error.message}`);
      }

      // 确保数据结构有效
      versionRelease = versionRelease.versions
        ? versionRelease
        : { versions: [] };
    }

    this.generateVersionedChangelogs(mergedData, versionRelease);
  }

  renderChangelogForVersion(version, releaseDate, groupedCommits) {
    let markdown = `# ${version}\n\n`;

    // 添加文档生成时间
    markdown += `发布时间: ${releaseDate}\n\n`;

    // 按预设顺序组织分类
    const categoryOrder = [
      "breaking",
      "feat",
      "fix",
      "perf",
      "docs",
      "refactor",
      "test",
      "chore",
      "other",
    ];

    categoryOrder.forEach((categoryKey) => {
      const category = groupedCommits[categoryKey];
      if (!category.items.length) return;

      markdown += `## ${category.title}\n`;

      category.items.forEach((commit) => {
        // 统一解析提交信息
        const parsed = parseCommitMessage(commit);
        let entry = `- **${commit.revision}**`;

        // 处理 scope
        if (parsed?.scope) {
          entry += ` **(${parsed.scope})**`;
        }

        // 处理 subject/message
        entry += `: ${parsed?.subject || commit.message}`;
        if (config.other.showAuthor) entry += `\n  - Author: ${commit.author}`;
        if (config.other.showDate)
          entry += `\n  - Date: ${new Date(commit.date).toLocaleDateString()}`;

        markdown += entry + "\n";
      });

      markdown += "\n"; // 分类间隔空行
    });

    return markdown;
  }

  generateVersionedChangelogs(mergedData, versionRelease) {
    // 确保传入参数有效性
    if (!versionRelease?.versions) {
      versionRelease = { versions: [] };
      logger.warn("使用空版本发布配置");
    }
    // 获取当前最大有效修订号
    const maxAvailableRev = mergedData.latestRev;
    // 记录是否发生过to值修正
    let hasAdjustedTo = false;
    // 自动修正版本范围（新增逻辑）
    const sanitizedVersions = versionRelease.versions
      .map((v) => {
        const originalTo = v.to; // 保存原始to值
        const sanitized = { ...v, originalTo }; // 新增原始值记录

        // 自动修正from下限
        if (sanitized.from < 0) {
          logger.warn(
            `[版本${v.version}] from值${v.from}低于最小值0，自动修正为0`
          );
          sanitized.from = 0;
        }

        // 自动修正to上限
        if (sanitized.to >= maxAvailableRev) {
          hasAdjustedTo = true; // 标记存在to修正
          if (sanitized.to > maxAvailableRev) {
            logger.warn(
              `[版本${v.version}] to值${v.to}超过最大可用修订号${maxAvailableRev}，自动修正为${maxAvailableRev}`
            );
            sanitized.to = maxAvailableRev;
          }
        }

        // 检查无效范围
        if (sanitized.from > sanitized.to) {
          logger.error(
            `[版本${v.version}] 无效范围from:${sanitized.from} > to:${sanitized.to}，跳过该版本`
          );
          return null;
        }

        return sanitized;
      })
      .filter(Boolean); // 过滤无效版本

    // 替换原版本配置
    versionRelease.versions = sanitizedVersions;

    // 允许 revision >= -1 的提交
    const allCommits = Object.values(mergedData.commits)
      .filter((c) => c.revision >= -1)
      .sort((a, b) => a.revision - b.revision);

    // 分离常规提交和 revision=-1 的特殊提交
    const validCommits = allCommits.filter((c) => c.revision !== -1);
    const latestCommits = allCommits.filter((c) => c.revision === -1);

    const releasedRevisions = new Set();

    // 处理已发布版本
    versionRelease.versions.forEach((v) => {
      const commitsInVersion = validCommits
        .filter((c) => c.revision >= v.from && c.revision <= v.to)
        .sort((a, b) => a.revision - b.revision);
      const filename = `changelog_${v.version.replace(/\./g, "_")}.md`;
      const filePath = path.join(
        svnHooksDir,
        svnHookDirName,
        "changelogs",
        filename
      );
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        logger.info(`创建了 ${dir} 目录。`);
      }
      if (!config.alwaysGenerate && fs.existsSync(filePath)) return;

      // 记录已发布的revision
      commitsInVersion.forEach((c) => releasedRevisions.add(c.revision));

      // 生成分类后的changelog
      const groupedCommits = this.groupCommitsByType(commitsInVersion);
      const markdown = this.renderChangelogForVersion(
        v.version,
        v.releaseDate,
        groupedCommits
      );
      fs.writeFileSync(filePath, markdown);
      logger.info(`Generated: ${filePath}`);
    });

    // 处理未发布提交（包含常规未发布 + 最新提交）
    let unreleasedCommits;
    if (hasAdjustedTo) {
      // 情况1：存在to值修正时，仅保留特殊提交
      unreleasedCommits = latestCommits;
    } else {
      // 情况2：正常处理未发布提交
      let maxReleasedRev = 0;
      versionRelease.versions.forEach((v) => {
        if (v.to > maxReleasedRev) maxReleasedRev = v.to;
      });
      unreleasedCommits = [
        // 筛选条件变更：仅包含大于maxReleasedRev的常规提交
        ...validCommits.filter(
          (c) =>
            c.revision > maxReleasedRev && !releasedRevisions.has(c.revision)
        ),
        ...latestCommits, // 始终包含特殊提交
      ].sort((a, b) => a.revision - b.revision); // 排序时-1会排在最前面
    }

    if (unreleasedCommits.length > 0) {
      let unreleaseDescription = `UNRELEASED VERSION (since last release)`;
      const groupedUnreleased = this.groupCommitsByType(unreleasedCommits);
      const parsed = parseCommitMessage(latestCommits[0]);
      if (!parsed || !parsed.type) {
        // 如果解析失败, 追加
        unreleaseDescription += `\n\n**Note:** The latest commit message could not be parsed correctly. Please ensure it follows the conventional commit message format.\n\nLatest Commit Message:\n\n${JSON.stringify(
          latestCommits,
          null,
          2
        )}`;
      }
      let unreleasedMarkdown = this.renderChangelogForVersion(
        "unrelease",
        unreleaseDescription,
        groupedUnreleased
      );
      const filePath = path.join(
        svnHooksDir,
        svnHookDirName,
        "changelogs",
        "changelog_unrelease.md"
      );
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        logger.info(`创建了 ${dir} 目录。`);
      }
      fs.writeFileSync(filePath, unreleasedMarkdown);
      logger.info(`Generated: ${filePath}`);
    }
  }

  groupCommitsByType(commits) {
    const categories = {
      breaking: { title: "🚨 Breaking Changes", items: [] },
      feat: { title: "✨ Features", items: [] },
      fix: { title: "🐛 Bug Fixes", items: [] },
      perf: { title: "⚡ Performance Improvements", items: [] },
      docs: { title: "📚 Documentation", items: [] },
      refactor: { title: "♻ Code Refactoring", items: [] },
      test: { title: "✅ Tests", items: [] },
      chore: { title: "🔧 Chores", items: [] },
      other: { title: "📦 Other", items: [] },
    };

    commits.forEach((commit) => {
      const parsed = parseCommitMessage(commit);
      if ((!parsed || !parsed.type) && !config.other.showOtherCommitLogs)
        return;
      let added = false;

      // 处理破坏性变更（优先级最高）
      if (parsed && parsed.breaking) {
        categories.breaking.items.push(commit);
        added = true;
      }

      // 按类型分类
      if (parsed && parsed.type) {
        const type = parsed.type.toLowerCase();
        if (categories[type]) {
          categories[type].items.push(commit);
          added = true;
        }
      }

      // 未识别类型的提交
      if (!added) {
        categories.other.items.push(commit);
      }
    });

    return categories;
  }

  loadData() {
    try {
      const rawData = fs.readFileSync(this.dataFile, "utf8");
      const data = JSON.parse(rawData);
      logger.info("Loaded data from file");
      logger.debug(data);

      // 数据完整性校验
      if (!data.commits || data.latestRev === undefined) {
        logger.error("Invalid data file structure:", data);
        throw new Error("Invalid data file structure");
      }

      return data;
    } catch (error) {
      logger.error(`Failed to load data: ${error.message}`);
      throw new Error(`Failed to load data: ${error.message}`);
    }
  }
}

function findSvnHooksDir(startPath) {
  let currentPath = startPath;

  while (currentPath && currentPath !== path.parse(currentPath).root) {
    const svnDirPath = path.join(currentPath, '.svn'); // 检查.svn目录
    if (fs.existsSync(svnDirPath) && fs.lstatSync(svnDirPath).isDirectory()) {
      // 如果找到了.svn目录，则在此目录下查找hooks目录
      const svnHooksPath = path.join(currentPath, svnHookDirName);
      if (fs.existsSync(svnHooksPath) && fs.lstatSync(svnHooksPath).isDirectory()) {
        return currentPath; // 返回找到hooks目录的路径
      } else {
        return null; // 如果存在.svn但不存在hooks目录，返回null
      }
    }

    const svnHooksPath = path.join(currentPath, svnHookDirName);
    if (fs.existsSync(svnHooksPath) && fs.lstatSync(svnHooksPath).isDirectory()) {
      return currentPath;
    }

    // Move up one directory level
    currentPath = path.dirname(currentPath);
  }

  return null; // If not found
}

function getSvnLogs(startRevision = 1) {
  try {
    logger.info(`Getting SVN logs from local svnHooksDir ${svnHooksDir}`);
    if (!svnHooksDir) {
      throw new Error("Repository path not provided!");
    }
    logger.info(`Getting SVN logs from revision ${startRevision}`);
    // 1. Execute SVN log command and capture the output as XML
    // The command fetches logs from the specified start revision to the latest revision (HEAD) in XML format.
    const svnLog = execSync(`svn log -r ${startRevision}:HEAD --xml`, {
      encoding: "utf8",
      cwd: svnHooksDir, // 关键修改：指定子进程的工作目录
      stdio: ["pipe", "pipe", "ignore"], // 忽略错误输出
    });
    logger.debug(`svnLog: ${svnLog}`);

    // 2. 读取当前提交的消息
    const commitMsg = fs.readFileSync(messageFilePath, "utf8").trim();
    const date = new Date().toISOString().replace(/\.\d+Z$/, ".000000Z");
    // 4. 构造当前提交的日志条目（字符串形式）
    const newEntry = `
    <logentry revision="-1">
      <author>debug</author>
      <msg>${commitMsg}</msg>
      <date>${date}</date>
    </logentry>
    `;
    logger.info(`newEntry: ${newEntry}`);
    // 5. 将新条目插入到历史日志的末尾（直接字符串拼接）
    const mergedLogs = svnLog.replace(
      /<\/log>/,
      `${newEntry}</log>` // 在 </log> 前插入新条目
    );
    logger.debug(`mergedLogs: ${mergedLogs}`);

    const logs = [];
    const matches = mergedLogs.matchAll(/<logentry[^>]*>[\s\S]*?<\/logentry>/g);

    for (const match of matches) {
      const revision = match[0].match(/revision="(.*?)"/)[1];
      const message = match[0].match(/<msg>([\s\S]*?)<\/msg>/)[1];
      const date = match[0].match(/<date>([\s\S]*?)<\/date>/)[1];
      const author = match[0].match(/<author>([\s\S]*?)<\/author>/)[1];

      logs.push({
        revision,
        message: message.trim(),
        date: new Date(date),
        author: author.trim(),
      });
    }

    logger.info(`Retrieved ${logs.length} commit logs`);
    // logger.debug(`mergedLogs: ${mergedLogs}`);

    return logs;
  } catch (error) {
    logger.error(`Failed to get SVN logs: ${error.message}`);
    throw error;
  }
}

function parseCommitMessage(commit) {
  try {
    const options = {
      // 正则表达式，用于解析提交信息的标题部分
      headerPattern: /^(\w*)(?:\(([\w$.\-*/ ]*)\))?(!?): (.*)$/,
      // 示例：feat(scope): 添加新功能
      // 解析结果：
      // type: "feat"
      // scope: "scope"
      // breaking: undefined (没有!)
      // subject: "添加新功能"

      // 新增字段映射配置，定义正则表达式的捕获组与解析结果字段的对应关系
      headerCorrespondence: [
        "type", // 第1组 → type，如 "feat", "fix" 等
        "scope", // 第2组 → scope，如 "(scope)" 中的 "scope"
        "breaking", // 第3组 → breaking标记（!），如 "!" 表示有重大变更
        "subject", // 第4组 → subject，如 "添加新功能"
      ],

      // 关键字列表，用于识别提交信息中的重大变更说明
      noteKeywords: ["BREAKING CHANGE", "BREAKING-CHANGE"],
      // 示例： BREAKING CHANGE: 移除旧接口
    };

    // 使用 conventionalCommitsParser.sync 方法解析提交信息
    const parsed = conventionalCommitsParser.sync(commit.message, options);

    return {
      type: parsed.type?.toLowerCase() || null,
      scope: parsed.scope,
      subject: parsed.subject, // 现在能正确获取subject
      body: parsed.body,
      breaking:
        parsed.breaking ||
        parsed.notes.some((n) => n.title === "BREAKING CHANGE"),
      raw: commit.message,
    };
  } catch (error) {
    logger.warn(
      `解析提交信息失败: ${error.message} - 原始信息: ${JSON.stringify(
        commit,
        null,
        2
      )}`
    );
    return null;
  }
}

(async () => {
  try {
    // 加载配置文件
    const configPath = path.join(svnHooksDir, svnHookDirName, "config.json");
    if (!fs.existsSync(configPath)) {
      logger.error(`未找到配置文件: ${configPath}`);
      process.exit(1);
    }

    config = require(configPath);

    // 现在你可以使用 config 对象了
    logger.info("成功加载配置文件:", configPath);
    logger.debug("Configuration:", config);

    const manager = new ChangelogManager();
    manager.fetchNewLogs().then(() => manager.generate());
  } catch (error) {
    logger.error("Error generating changelog:", error);
    process.exit(1); // 明确返回错误退出码
  }
})();
