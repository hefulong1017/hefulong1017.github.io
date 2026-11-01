
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

