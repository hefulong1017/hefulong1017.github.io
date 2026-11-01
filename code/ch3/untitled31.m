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

% 共轭梯度（CG）方法
if all(eig(B) > 0) % 确保矩阵是正定的
    disp('CG Iteration Results:');
    [x_cg, flag, relres, iter] = pcg(B, b, tol, maxIter);
    if flag == 0
        disp(['CG converged at iteration ', num2str(iter), ' with relative residual ', num2str(relres)]);
    else
        disp('CG did not converge.');
    end
else
    disp('Matrix B is not positive definite. CG cannot be used.');
end

% MINRES 方法
disp('MINRES Iteration Results:');
[x_minres, flag, relres, iter] = minres(B, b, tol, maxIter);
if flag == 0
    disp(['MINRES converged at iteration ', num2str(iter), ' with relative residual ', num2str(relres)]);
else
    disp('MINRES did not converge.');
end

% LSQR 方法
disp('LSQR Iteration Results:');
[x_lsqr, flag, relres, iter] = lsqr(B, b, tol, maxIter);
if flag == 0
    disp(['LSQR converged at iteration ', num2str(iter), ' with relative residual ', num2str(relres)]);
else
    disp('LSQR did not converge.');
end