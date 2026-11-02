# PINNLab 公共体验版

这是 PINNLab 的 Docker 发布包。访客可以在网页中编辑 LaTeX 方程、填写计算域与初边值、运行 PINN 数值候选，并查看曲线、曲面切片或逐点结果。

## 先本机预览

电脑安装 Docker 后，在本目录打开终端运行：

```bash
docker build -t pinnlab-public .
docker run --rm -p 8501:8501 pinnlab-public
```

浏览器访问 <http://localhost:8501>。首次构建需要下载 Python 和数值计算依赖。

## 发布到公网

1. 解压发布包，把解压目录里的文件直接放进 GitHub 仓库根目录。确认 `Dockerfile` 位于仓库根目录，而不是再套一层文件夹。
2. 在支持 Dockerfile 的托管平台创建 Web 服务并连接该仓库。构建目录使用仓库根目录；平台会读取 `Dockerfile`。应用读取平台提供的 `PORT`，默认端口为 `8501`，健康检查地址为 `/_stcore/health`。
3. 等待构建完成，打开托管平台分配的公开网址，试算一个方程并检查结果页面。复制这个网址用于个人主页。

公开体验模式每个实例同时处理一个求解任务，单次计算最多 20 秒。启用公式图片识别会增加模型下载和内存需求；托管平台需允许应用访问外网模型源。也可以在 Docker 构建时关闭图片识别：

```bash
docker build --build-arg ENABLE_EQUATION_OCR=0 -t pinnlab-public .
```

## 嵌入个人主页

把 `https://YOUR-APP-URL/` 替换为托管平台给出的实际网址：

```html
<iframe
  src="https://YOUR-APP-URL/?embed=true"
  title="PINNLab 偏微分方程体验工作台"
  width="100%"
  height="900"
  loading="lazy"
  style="border:0"
  allow="clipboard-read; clipboard-write">
</iframe>
```

如果主页平台不允许 iframe，可以改为放一个指向该网址的“打开方程求解器”按钮。

## 功能与适用范围

- LaTeX 方程输入，支持最多三个空间坐标 `x,y,z` 和可选时间坐标 `t`。
- 已通过方程族的 1D、2D、3D 输入模板，包含坐标依赖变系数示例；新维度和新系数组合尚未逐类完成独立误差审计。
- 上传方程图片并识别为 LaTeX。图片会发送到部署服务器处理；识别结果需人工核对。
- 单点查询、CSV 导出，以及固定坐标后的曲线、曲面切片展示。

这是教学和研究演示原型。公式编译成功不代表数值解已经验证，也不保证误差普遍优于差分或有限元方法。请勿将公开实例用于生产计算或提交敏感图片。
