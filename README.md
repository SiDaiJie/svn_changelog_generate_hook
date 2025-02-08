# SVN 变更日志生成工具使用说明

## 环境要求
- 版本控制：TortoiseSVN
- 依赖管理：Node.js + npm

## 快速配置指南

### 1. 钩子文件部署
```bash
# 钩子文件存放路径
D:\ProgramFiles\SVNHooks\
│   generate-changelog.js
│   logger.js # 日志记录模块,默认this.debugEnable = false;
│   package.json
|   svn-hooks.log  # 自动生成的日志文件,用于调试
└── pre-commit.bat

# 安装依赖
cd /d D:\ProgramFiles\SVNHooks
npm install
```

### 2. TortoiseSVN 钩子配置
**一次配置,全局生效**
1. 右键项目文件夹 -> TortoiseSVN -> Settings
2. 进入 Hook Scripts 设置页
3. 添加 Pre-Commit 钩子：
   - **Hook Type**: Pre-Commit Hook
   - **Working Copy Path**: *
   - **Command Line**: `D:\ProgramFiles\SVNHooks\pre-commit.bat`
   - 勾选 _"Wait for the command to complete"_
   - 取消勾选 _"Hide the script while running"_
   - 取消勾选 _"Always execute the script"_

### 3. 项目文件配置
```bash
# 项目目录结构
project-root/
├── .svn/
├── .svn-hooks/ # 这个文件夹需要在 TortoiseSVN 中配置 Unversion and add to ignore list
│   ├── tmp/  # 临时文件夹,用于存放中间文件
│   ├── changelogs/  # 自动生成的 changelog 文件夹
│   ├── README.md
│   ├── config.json
│   └── version-release copy.json
├── src/
└── version-release.json  # 手动创建并维护

# 初始化命令（在项目根目录执行）
cd /d "你的项目路径"
copy ".svn-hooks\version-release copy.json" "version-release.json"
```

## 触发方法
- 使用 ToroiseSVN 提交代码时,TortoiseSVN 会自动执行 `.svn-hooks\post-commit.bat` 脚本,生成 changelog 文件

## 提交规范说明
### 格式要求
```
<type>(<scope>): <subject>
[空行]
<body>
[空行]
<footer>
```

### 有效提交类型
| 类型     | 说明                                  |
| -------- | ------------------------------------- |
| feat     | 新增功能                              |
| fix      | Bug修复                               |
| docs     | 文档更新                              |
| style    | 代码格式调整（不影响运行结果）        |
| perf     | 性能优化                              |
| test     | 测试用例相关                          |
| refactor | 代码重构（既不是新功能也不是bug修复） |
| chore    | 构建/依赖变更                         |

### 示例代码
```bash
# 单行示例
svn commit -m "feat: 新增双因素认证功能"

# 多行示例
svn commit -m "fix: 修复金额计算错误

- 修正小数点四舍五入逻辑
- 增加货币单位校验

BREAKING CHANGE: 移除旧版支付接口"

# 带作用域的破坏性提交
svn commit -m "chore(deps)!: 升级Node.js到18.x版本"
```

### 两种标记方式等效
1. **正文标记法**  
   在提交正文中包含 `BREAKING CHANGE:` 说明：
   ```bash
   feat(core): 重构用户认证模块
   
   BREAKING CHANGE: 移除旧版JWT认证接口
   ```

2. **感叹号标记法**  
   在类型/作用域后直接添加 `!` 符号：
   ```bash
   feat(core)!: 移除旧版JWT认证接口
   ```

## 版本更新规则
| 变更类型       | 版本升级 | 触发条件                      |
| -------------- | -------- | ----------------------------- |
| 破坏性变更     | MAJOR↑   | 存在 `!` 或 `BREAKING CHANGE` |
| 新增功能(feat) | MINOR↑   | 无破坏性标记                  |
| 问题修复(fix)  | PATCH↑   | 无破坏性标记                  |

## 注意事项
1. 提交前请确保版本文件存在：`version-release.json`,不存在也没关系,只会有一个默认unreleased的版本

```json
# 配置建议
{
  "versions": [
    {
      "version": "V1.0.0",
      "from": 10,
      "to": 20,
      "releaseDate": "2025-01-20"
    },
    {
      "version": "V2.0.0",
      "from": 21,
      "to": 34,
      "releaseDate": "2025-01-24"
    }
  ]
}
```
2. 破坏性变更必须包含 `BREAKING CHANGE:` 说明
3. 每次提交会自动更新项目根目录的 CHANGELOG.md
4. 若钩子执行失败,提交操作将被中止
5. Working Copy Path的配置为 `*` 表示可以对整个电脑的工作副本进行钩子操作
6. **WARN** : post-commit.bat 会从你触发提交的目录开始,一直往前找`.svn-hooks`文件夹,如果找不到,将会出错,如果找的不对,changelog将会不正确 
7. 如果生成的changelog不正确,请检查配置,删除`.svn-hooks`文件夹中的`tmp`文件夹,重新提交一次

😊