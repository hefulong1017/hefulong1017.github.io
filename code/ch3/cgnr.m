% 设置 ii = 1 的参数
ii = 1;
m = 10*2^(ii-1);  % 对应于 ii=1 时 m=10
n = 100*4^(ii-1); % 对应于 ii=1 时 n=100
x1 = 0; x2 = 1; t1 = 0; t2 = 1;
h = (x2-x1)/m; dt =(t2-t1)/n;

r = dt /(h^2);
rowA = [5/6+r, 1/12-r/2, zeros(1,m-3)];
A = toeplitz(rowA, [5/6+r, 1/12-r/2, zeros(1,m-3)]');
rowB = [5/6-r, 1/12+r/2, zeros(1,m-3)];
B = toeplitz(rowB, [5/6-r, 1/12+r/2, zeros(1,m-3)]');

disp('Matrix A for ii=1:');
disp(A);
disp('Matrix B for ii=1:');
disp(B);

% 测试向量 b
b = ones(m-1, 1);

% 定义最大迭代次数和容差
maxIter = 1000;
tol = 1e-6;
x0 = zeros(m-1, 1); % 初始猜测

% 基于法方程的共轭梯度法
disp('CGNR Iteration Results:');
[x_cgnr, iter, residual] = cgnr(B, b, x0, tol, maxIter);
disp(['CGNR converged at iteration ', num2str(iter), ' with residual ', num2str(residual)]);

% SOR 方法
omega = 1.5;  % 松弛因子
disp('SOR Iteration Results:');
try
    [x_sor, iter, residual] = sor(B, b, omega, x0, tol, maxIter);
    disp(['SOR converged at iteration ', num2str(iter), ' with residual ', num2str(residual)]);
catch ME
    disp(ME.message);
end

% 基于KKT方程的SOR类迭代法
C = eye(m-1); % 示例中的等式约束矩阵
d = zeros(m-1, 1); % 示例中的等式约束向量
z0 = [x0; zeros(m-1, 1)]; % 初始猜测
lambda = 1e-6; % 正则化参数
disp('KKT-SOR Iteration Results:');
try
    [z_kkt, iter, residual] = kkt_sor(B, C, b, d, omega, z0, tol, maxIter, lambda);
    disp(['KKT-SOR converged at iteration ', num2str(iter), ' with residual ', num2str(residual)]);
catch ME
    disp(ME.message);
end