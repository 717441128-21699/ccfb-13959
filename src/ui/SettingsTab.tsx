import { useApp } from '../state/AppContext';

export function SettingsTab() {
  const { settings, setSettings } = useApp();
  return (
    <div className="tab-body">
      <section className="card">
        <h2>系统设置</h2>
        <div className="form-grid wide">
          <label>
            标定系数 μm/px(真实显微图尺寸换算)
            <input
              type="number"
              step={0.01}
              value={settings.umPerPx}
              onChange={(e) => setSettings({ ...settings, umPerPx: Number(e.target.value) })}
            />
          </label>
          <label>
            GPU 自适应阈值灵敏度(0.04 灵敏 ~ 0.14 保守)
            <input
              type="number"
              step={0.01}
              min={0.02}
              max={0.2}
              value={settings.thresholdC}
              onChange={(e) => setSettings({ ...settings, thresholdC: Number(e.target.value) })}
            />
          </label>
          <label>
            单样品图片张数预算
            <input
              type="number"
              value={settings.imageBudget}
              onChange={(e) => setSettings({ ...settings, imageBudget: Number(e.target.value) })}
            />
          </label>
          <label>
            时间预算(ms)
            <input
              type="number"
              step={1000}
              value={settings.timeBudgetMs}
              onChange={(e) => setSettings({ ...settings, timeBudgetMs: Number(e.target.value) })}
            />
          </label>
        </div>
        <div className="card inner">
          <h3>染色鲁棒性说明</h3>
          <p className="hint">
            管线在 GPU 端依次执行:灰度世界白平衡(纹理 mipmap 取全图均值)→ 局部均值归一化(17-tap 可分离盒式模糊)
            → 双极性自适应阈值。分类器只使用几何与纹理描述子(圆度、长宽比、实心度、棱角锐度、纹孔密度、壁腔比等),
            不读取颜色通道,因此更换检验员或染色批次造成的色调/深浅漂移不会改变分类结果。
          </p>
        </div>
        <div className="card inner">
          <h3>90% 准确率达标路径</h3>
          <ol className="hint">
            <li>用「合成测试」页批量回归,先在常规场景使综合准确率 ≥90%;</li>
            <li>切换「染色强漂移」场景验证颜色不变性,指标应基本不下降;</li>
            <li>用「掺伪样品」场景验证第二成分识别率 ≥70%;</li>
            <li>收集药检所真实照片,人工复核标注后在特征库校准阈值与尺寸范围;</li>
            <li>分类器阈值集中在 src/cv/classifier.ts,可按混淆矩阵针对性调参。</li>
          </ol>
        </div>
      </section>
    </div>
  );
}
