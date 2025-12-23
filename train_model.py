import pandas as pd
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.utils import resample

df = pd.read_csv('ml-training-data.csv')

target_col = 'did_hight_density_solver_find_solution'

exclude_features = [
    'board_aspect_ratio_not_normalized',
    'width_normalized_to_max_side',
    'height_normalized_to_max_side',
    'bottom_edge_ports_normalized_to_width',
    'left_edge_ports_normalized_to_height',
    'right_edge_ports_normalized_to_height',
    'top_edge_ports_normalized_to_width'
]

df_success = df[df[target_col] == True].copy()
df_fail = df[df[target_col] == False].copy()

df[target_col] = df[target_col].astype(int)

print(f"Original: Success={len(df_success)}, Fail={len(df_fail)}")

target_fail = 360
target_success = 240

df_fail_sampled = resample(df_fail, n_samples=min(target_fail, len(df_fail)), random_state=42, replace=True)
df_success_sampled = resample(df_success, n_samples=target_success, random_state=42)

df_balanced = pd.concat([df_fail_sampled, df_success_sampled]).sample(frac=1, random_state=42)

print(f"Resampled: Success={len(df_success_sampled)}, Fail={len(df_fail_sampled)}")

X_balanced = df_balanced.drop(columns=[target_col] + exclude_features)
y_balanced = df_balanced[target_col]

correlations = X_balanced.corrwith(y_balanced).abs().sort_values(ascending=False)
top_features = correlations.head(12).index.tolist()

print(f"\nSelected features: {top_features}")

X_selected = X_balanced[top_features]

scaler = StandardScaler()
X_scaled = scaler.fit_transform(X_selected)

model = LogisticRegression(max_iter=3000, C=100, random_state=42)
model.fit(X_scaled, y_balanced)

y_pred = model.predict(X_scaled)
accuracy = (y_pred == y_balanced).mean() * 100

print(f"\nAccuracy: {accuracy:.2f}%")

temperature = 0.05

decision_function = model.decision_function(X_scaled)
base_probs = 1 / (1 + np.exp(-decision_function))
scaled_logits = np.log(base_probs / (1 - base_probs + 1e-10)) / temperature
extreme_probs = 1 / (1 + np.exp(-scaled_logits))

y_pred_temp = (extreme_probs > 0.5).astype(int)
temp_accuracy = (y_pred_temp == y_balanced).mean() * 100

false_positives = ((y_pred_temp == 1) & (y_balanced == 0)).sum()
false_negatives = ((y_pred_temp == 0) & (y_balanced == 1)).sum()
extreme_count = ((extreme_probs < 0.1) | (extreme_probs > 0.9)).sum()
extreme_percentage = extreme_count / len(extreme_probs) * 100

print(f"Temperature-scaled accuracy: {temp_accuracy:.2f}%")
print(f"False Positives: {false_positives}")
print(f"False Negatives: {false_negatives}")
print(f"Extreme predictions (<0.1 or >0.9): {extreme_percentage:.1f}%")

camel_names = []
for name in top_features:
    parts = name.split('_')
    camel = parts[0] + ''.join(w.capitalize() for w in parts[1:])
    camel_names.append(camel)

weights = model.coef_[0]
bias = model.intercept_[0]
means = scaler.mean_
stds = scaler.scale_

params_obj = ', '.join(camel_names)
features_list = ',\n    '.join(f"params.{name}" for name in camel_names)
means_str = ', '.join(f"{m:.6f}" for m in means)
stds_str = ', '.join(f"{s:.6f}" for s in stds)
weights_str = ', '.join(f"{w:.6f}" for w in weights)

params_type_fields = ',\n  '.join(f"{name}: number" for name in camel_names)

ts_code = f"""export interface HighDensitySolverParams {{
  {params_type_fields}
}}

export function predictHighDensitySolverSuccess(params: HighDensitySolverParams): number {{
  const features = [
    {features_list}
  ];

  const means = [
    {means_str}
  ];

  const stds = [
    {stds_str}
  ];

  const weights = [
    {weights_str}
  ];

  const bias = {bias:.6f};
  const temperature = {temperature};

  const normalized = features.map((f, i) => (f - means[i]) / stds[i]);
  const z = normalized.reduce((sum, x, i) => sum + x * weights[i], bias);
  const baseProb = 1 / (1 + Math.exp(-z));
  const logit = Math.log(baseProb / (1 - baseProb + 1e-10));
  const scaledLogit = logit / temperature;
  const extremeProb = 1 / (1 + Math.exp(-scaledLogit));

  return extremeProb;
}}

export function willHighDensitySolverSucceed(params: HighDensitySolverParams): boolean {{
  return predictHighDensitySolverSuccess(params) > 0.5;
}}
"""

import os
output_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'hd_solver_predictor.ts')
with open(output_path, 'w') as f:
    f.write(ts_code)

print(f"\nGenerated {output_path}")