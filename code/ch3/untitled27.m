function [Q, R] = givens_rotation(A)
    [m, n] = size(A);
    R = A;
    Q = eye(m);

    for j = 1:min(m-1, n)
        for i = m-1:-1:j
            if R(i+1, j) ~= 0
                r = sqrt(R(i, j)^2 + R(i+1, j)^2);
                c = R(i, j) / r;
                s = -R(i+1, j) / r;

                G = eye(m);
                G([i, i+1], [i, i+1]) = [c, s; -s, c];
                
                R = G' * R;
                Q = Q * G;
            end
        end
    end

    Q = Q';
    R = triu(R);
end

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

% SSOR 迭代
function x = ssor(A, b, omega, maxIter, tol)
    D = diag(diag(A));
    L = tril(A, -1);
    U = triu(A, 1);
    M = inv(D/omega + L) * (D*(2/omega - 1) - U);
    x = zeros(size(b));  % 初始猜测
    residual = norm(b - A*x);
    iter = 0;

    while residual > tol && iter < maxIter
        x = M * x + inv(D/omega + L) * b;
        residual = norm(b - A*x);
        iter = iter + 1;
    end
    disp(['SSOR Iterations: ', num2str(iter)]);
end

% HSS 迭代
function x = hss(A, b, alpha, maxIter, tol)
    n = length(b);
    H = (A + A') / 2;
    S = (A - A') / 2;
    I = eye(n);
    
    x = zeros(size(b));  % 初始猜测
    residual = norm(b - A*x);
    iter = 0;

    while residual > tol && iter < maxIter
        z = (alpha*I + H) \ ((alpha*I - S)*x + b);
        x = (alpha*I + S) \ ((alpha*I - H)*z + b);
        residual = norm(b - A*x);
        iter = iter + 1;
    end
    disp(['HSS Iterations: ', num2str(iter)]);
end

% PHSS 迭代
function x = phss(A, b, alpha, maxIter, tol)
    n = length(b);
    H = (A + A') / 2;
    S = (A - A') / 2;
    I = eye(n);
    
    x = zeros(size(b));  % 初始猜测
    residual = norm(b - A*x);
    iter = 0;

    while residual > tol && iter < maxIter
        z = (alpha*I + H) \ ((alpha*I - S)*x + b);
        x = (alpha*I + H) \ ((alpha*I - S)*z + b);
        residual = norm(b - A*x);
        iter = iter + 1;
    end
    disp(['PHSS Iterations: ', num2str(iter)]);
end

% 测试向量 b
b = ones(m-1, 1);

% SSOR 参数
omega = 1.5;  % 松弛因子
maxIter = 1000;
tol = 1e-6;

% HSS 和 PHSS 参数
alpha = 1.0;

disp('SSOR Iteration Results:');
x_ssor = ssor(B, b, omega, maxIter, tol);

disp('HSS Iteration Results:');
x_hss = hss(B, b, alpha, maxIter, tol);

disp('PHSS Iteration Results:');
x_phss = phss(B, b, alpha, maxIter, tol);